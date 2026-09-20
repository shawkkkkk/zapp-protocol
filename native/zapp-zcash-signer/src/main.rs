use anyhow::{Context, Result, anyhow, bail};
use secp256k1::{Message, PublicKey, Secp256k1, SecretKey};
use serde::{Deserialize, Serialize};
use std::io::{Read, Write};
use transparent::{
    address::Script,
    bundle::{self as transparent_bundle, TxOut},
    sighash::{SighashType, TransparentAuthorizingContext},
};
use zcash_primitives::transaction::{
    Authorization as TxAuthorization, Authorized as TxAuthorized, Transaction,
    sighash::{SignableInput, signature_hash},
    txid::TxIdDigester,
};
use zcash_protocol::{consensus::BranchId, value::Zatoshis};
use zcash_script::script;

#[derive(Debug, Deserialize)]
struct Input {
    raw_tx_hex: String,
    prev_script_pubkey_hex: String,
    prev_value_zats: String,
    redeem_script_hex: String,
    content_hex: String,
    content_type: String,
    wif: String,
    expected_pubkey_hex: String,
}

#[derive(Debug, Serialize)]
struct Output {
    signed_tx_hex: String,
    script_sig_hex: String,
    signature_hex: String,
}

#[derive(Clone, Debug)]
struct TransparentAuth {
    all_prev_outputs: Vec<TxOut>,
}

impl transparent_bundle::Authorization for TransparentAuth {
    type ScriptSig = Script;
}

impl TransparentAuthorizingContext for TransparentAuth {
    fn input_amounts(&self) -> Vec<Zatoshis> {
        self.all_prev_outputs.iter().map(|o| o.value()).collect()
    }

    fn input_scriptpubkeys(&self) -> Vec<Script> {
        self.all_prev_outputs
            .iter()
            .map(|o| o.script_pubkey().clone())
            .collect()
    }
}

struct MapTransparent {
    auth: TransparentAuth,
}

impl transparent_bundle::MapAuth<transparent_bundle::Authorized, TransparentAuth> for MapTransparent {
    fn map_script_sig(&self, s: Script) -> Script {
        s
    }

    fn map_authorization(&self, _: transparent_bundle::Authorized) -> TransparentAuth {
        self.auth.clone()
    }
}

#[derive(Debug)]
struct PrecomputedAuth;

impl TxAuthorization for PrecomputedAuth {
    type TransparentAuth = TransparentAuth;
    type SaplingAuth = <TxAuthorized as TxAuthorization>::SaplingAuth;
    type OrchardAuth = <TxAuthorized as TxAuthorization>::OrchardAuth;
}

fn push_data(data: &[u8]) -> Result<Vec<u8>> {
    if data.len() <= 75 {
        let mut out = vec![data.len() as u8];
        out.extend_from_slice(data);
        Ok(out)
    } else if data.len() <= 255 {
        let mut out = vec![0x4c, data.len() as u8];
        out.extend_from_slice(data);
        Ok(out)
    } else {
        bail!("pushdata exceeds 255 bytes")
    }
}

fn push_num(n: usize) -> Result<Vec<u8>> {
    match n {
        0 => Ok(vec![0x00]),
        1..=16 => Ok(vec![0x50 + n as u8]),
        17..=255 => Ok(vec![0x01, n as u8]),
        _ => bail!("script number out of range"),
    }
}

fn split_content(content: &[u8]) -> Result<Vec<&[u8]>> {
    if content.is_empty() {
        bail!("empty inscription content");
    }
    let pieces: Vec<&[u8]> = content.chunks(240).collect();
    if pieces.len() > 4 {
        bail!("single-reveal ZApp NFT exceeds four pieces");
    }
    Ok(pieces)
}

fn build_script_sig(
    content: &[u8],
    content_type: &str,
    sig_with_type: &[u8],
    redeem_script: &[u8],
) -> Result<Vec<u8>> {
    let ct = content_type.as_bytes();
    if ct.len() < 3 || ct.len() > 96 || !content_type.contains('/') {
        bail!("invalid content type");
    }

    let pieces = split_content(content)?;
    let mut out = Vec::new();
    out.extend(push_data(b"ord")?);
    out.extend(push_num(pieces.len())?);
    out.extend(push_data(ct)?);

    for (i, piece) in pieces.iter().enumerate() {
        let index = pieces.len() - 1 - i;
        out.extend(push_num(index)?);
        out.extend(push_data(piece)?);
    }

    out.extend(push_data(sig_with_type)?);
    out.extend(push_data(redeem_script)?);
    if out.len() > 1650 {
        bail!("scriptSig exceeds Zcash standard relay limit");
    }
    Ok(out)
}

fn secret_from_wif(wif: &str) -> Result<SecretKey> {
    let mut payload = bs58::decode(wif)
        .with_check(None)
        .into_vec()
        .context("invalid WIF checksum")?;

    if payload.last() == Some(&1u8) {
        payload.pop();
    }
    if payload.len() < 32 {
        bail!("WIF payload too short");
    }
    let secret = &payload[payload.len() - 32..];
    SecretKey::from_slice(secret).context("invalid secp256k1 secret key")
}

fn main() -> Result<()> {
    if std::env::args().any(|arg| arg == "--self-test") {
        let json = serde_json::json!({
            "ok": true,
            "signer": "zapp-zcash-signer",
            "version": env!("CARGO_PKG_VERSION")
        });
        std::io::stdout().write_all(serde_json::to_string(&json)?.as_bytes())?;
        return Ok(());
    }

    let mut raw_input = String::new();
    std::io::stdin().read_to_string(&mut raw_input)?;
    let input: Input = serde_json::from_str(&raw_input)?;

    let raw_tx = hex::decode(&input.raw_tx_hex)?;
    let prev_script_bytes = hex::decode(&input.prev_script_pubkey_hex)?;
    let redeem_script_bytes = hex::decode(&input.redeem_script_hex)?;
    let content = hex::decode(&input.content_hex)?;

    let prev_value_zats: i64 = input
        .prev_value_zats
        .parse()
        .context("previous output value must be an integer zatoshi string")?;
    if prev_value_zats <= 0 {
        bail!("previous output value must be positive");
    }

    // For V5/V6 transactions the branch ID is encoded inside the transaction.
    // The read() fallback argument only applies to older formats, which ZApp does not create.
    let tx_for_sighash = Transaction::read(&raw_tx[..], BranchId::Nu5)?;
    let tx_for_signing = Transaction::read(&raw_tx[..], BranchId::Nu5)?;

    match tx_for_sighash.version() {
        zcash_primitives::transaction::TxVersion::V5 |
        zcash_primitives::transaction::TxVersion::V6 => {}
        _ => bail!("ZApp inscription signer only accepts V5+ Zcash transactions"),
    }

    let prev_value = Zatoshis::from_nonnegative_i64(prev_value_zats)
        .map_err(|_| anyhow!("invalid previous output value"))?;
    let prev_script = Script(script::Code(prev_script_bytes));
    let redeem_script = Script(script::Code(redeem_script_bytes.clone()));
    let prevout = TxOut::new(prev_value, prev_script.clone());

    let precomputed: zcash_primitives::transaction::TransactionData<PrecomputedAuth> =
        tx_for_sighash.into_data().map_authorization(
            MapTransparent {
                auth: TransparentAuth {
                    all_prev_outputs: vec![prevout],
                },
            },
            (),
            (),
        );

    let txid_parts = precomputed.digest(TxIdDigester);
    let bundle = precomputed
        .transparent_bundle()
        .ok_or_else(|| anyhow!("reveal transaction has no transparent bundle"))?;
    if bundle.vin.len() != 1 {
        bail!("ZApp reveal signer requires exactly one transparent input");
    }

    let signable = transparent::sighash::SignableInput::from_parts(
        bundle,
        SighashType::ALL,
        0,
        &redeem_script,
        &prev_script,
        prev_value,
    )?;
    let sighash = signature_hash(
        &precomputed,
        &SignableInput::Transparent(signable),
        &txid_parts,
    );

    let secret = secret_from_wif(&input.wif)?;
    let secp = Secp256k1::new();
    let derived_pubkey = PublicKey::from_secret_key(&secp, &secret).serialize();
    let expected_pubkey = hex::decode(&input.expected_pubkey_hex)?;
    if derived_pubkey.as_slice() != expected_pubkey.as_slice() {
        bail!("WIF does not match the expected reveal public key");
    }

    let msg = Message::from_digest_slice(sighash.as_ref())?;
    let signature = secp.sign_ecdsa(&msg, &secret);
    let mut sig_with_type = signature.serialize_der().to_vec();
    sig_with_type.push(SighashType::ALL.encode());

    let script_sig = build_script_sig(
        &content,
        &input.content_type,
        &sig_with_type,
        &redeem_script_bytes,
    )?;
    let script_sig_for_map = script_sig.clone();

    let signed_data = tx_for_signing.into_data().map_bundles::<TxAuthorized>(
        |bundle| {
            bundle.map(|mut b| {
                #[allow(deprecated)]
                {
                    b.vin[0].script_sig = Script(script::Code(script_sig_for_map));
                }
                b
            })
        },
        |b| b,
        |b| b,
    );

    let signed_tx = signed_data.freeze()?;
    let mut encoded = Vec::new();
    signed_tx.write(&mut encoded)?;

    let output = Output {
        signed_tx_hex: hex::encode(encoded),
        script_sig_hex: hex::encode(script_sig),
        signature_hex: hex::encode(sig_with_type),
    };
    let json = serde_json::to_vec(&output)?;
    std::io::stdout().write_all(&json)?;
    Ok(())
}
