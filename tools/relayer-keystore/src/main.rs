use oz_keystore::LocalClient;
use std::{env, fs, io::{self, Read}, path::PathBuf};
use stellar_strkey::ed25519::PrivateKey;

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let mut args = env::args().skip(1);
    let output_dir = PathBuf::from(args.next().ok_or("missing output directory")?);
    let filename = args.next().ok_or("missing keystore filename")?;
    if args.next().is_some() {
        return Err("unexpected arguments".into());
    }
    let password = env::var("RELAYER_KEYSTORE_PASSPHRASE")?;
    if password.len() < 12 {
        return Err("RELAYER_KEYSTORE_PASSPHRASE must be at least 12 characters".into());
    }

    fs::create_dir_all(&output_dir)?;
    let output_file = output_dir.join(&filename);
    if output_file.exists() {
        return Err(format!("refusing to overwrite {}", output_file.display()).into());
    }

    let mut secret = String::new();
    io::stdin().read_to_string(&mut secret)?;
    let private_key = PrivateKey::from_string(secret.trim())?;
    LocalClient::update(output_dir, password, Some(&filename), &private_key.0);
    println!("created {}", output_file.display());
    Ok(())
}
