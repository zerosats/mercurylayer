use std::{thread, time::Duration, env};

use anyhow::Result;
use bitcoin::Network;
use clap::{Parser, Subcommand};
use log::{info, debug};
use serde_json::json;

#[derive(Parser)]
#[command(author, version, about, long_about = None)]
#[command(propagate_version = true)]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    /// Create a wallet
    CreateWallet {
        /// The name of the wallet to create
        name: String,
    },
    /// Get new token.
    NewToken {},
    /// Get new deposit address. Used to fund a new statecoin.
    NewDepositAddress {
        wallet_name: String,
        token_id: String,
        amount: u32,
    },
    /// Broadcast the backup transaction to the network
    BroadcastBackupTransaction {
        wallet_name: String,
        statechain_id: String,
        to_address: Option<String>,
        /// Transaction fee rate in sats per byte
        fee_rate: Option<f64>,
    },
    /// Broadcast the backup transaction to the network
    ListStatecoins { wallet_name: String },
    /// Withdraw funds from a statechain coin to a bitcoin address
    Withdraw {
        wallet_name: String,
        statechain_id: String,
        to_address: String,
        /// Transaction fee rate in sats per byte
        fee_rate: Option<f64>,
        duplicated_index: Option<u32>,
    },
    /// Generate a transfer address to receive funds
    NewTransferAddress {
        wallet_name: String,
        /// Generate batch id for atomic transfers
        #[arg(short = 'b', long)]
        generate_batch_id: bool,
    },
    /// Send a statechain coin to a transfer address
    TransferSend {
        wallet_name: String,
        statechain_id: String,
        to_address: String,
        // Force send (required when the coin is duplicated)
        force_send: Option<bool>,
        /// Batch id for atomic transfers
        batch_id: Option<String>,
        duplicated_indexes: Option<Vec<u32>>,
    },
    /// Send a statechain coin to a transfer address
    TransferReceive { wallet_name: String },
    /// Create a payment hash for a lightning latch
    PaymentHash {
        wallet_name: String,
        statechain_id: String,
    },
    /// Confirm pending invoice
    ConfirmPendingInvoice {
        wallet_name: String,
        statechain_id: String,
    },
    /// Retrieve a payment pre-image for a lightning latch
    RetrievePreImage {
        wallet_name: String,
        statechain_id: String,
        batch_id: String,
    },
    /// Get the payment hash by batch id
    GetPaymentHash { batch_id: String },
}

#[tokio::main(flavor = "current_thread")]
async fn main() -> Result<()> {
    // Initialize logging - set RUST_LOG if not already set
    if env::var("RUST_LOG").is_err() {
        env::set_var("RUST_LOG", "info");
    }
    env_logger::init();

    let cli = Cli::parse();

    debug!("Starting Mercury Layer client");
    
    // Determine which configuration file will be used and get full absolute path
    let config_filename = if let Ok(network) = env::var("ML_NETWORK") {
        if network == "regtest" {
            "regtest.Settings.toml"
        } else {
            "Settings.toml"
        }
    } else {
        "Settings.toml"
    };
    
    // Get the current working directory and construct the full absolute path
    let current_dir = std::env::current_dir()?;
    let config_path = current_dir.join(config_filename);
    let config_full_path = config_path.canonicalize()
        .unwrap_or_else(|_| config_path.clone()); // fallback to non-canonicalized path if canonicalize fails
    
    // Log the config path only at debug level
    debug!("Configuration file path: {}", config_full_path.display());
    debug!("Loading client configuration from: {}", config_full_path.display());

    let client_config = mercuryrustlib::client_config::load().await;
    
    // Show essential network info at INFO level, detailed config at DEBUG level
    info!("Connected to {} network", match client_config.network {
        Network::Bitcoin => "Bitcoin",
        Network::Testnet => "Testnet",
        Network::Signet => "Signet", 
        Network::Regtest => "Regtest",
        _ => "Unknown"
    });
    
    // Move detailed configuration logging to debug level
    debug!("Configuration details:");
    debug!("  Statechain Entity: {}", client_config.statechain_entity);
    debug!("  Electrum Server: {}", client_config.electrum_server_url);
    debug!("  Electrum Type: {}", client_config.electrum_type);
    debug!("  Fee Rate Tolerance: {}", client_config.fee_rate_tolerance);
    debug!("  Max Fee Rate: {}", client_config.max_fee_rate);
    debug!("  Confirmation Target: {}", client_config.confirmation_target);
    if client_config.tor_proxy.is_some() {
        debug!("  Tor Proxy: enabled");
    } else {
        debug!("  Tor Proxy: disabled");
    }

    match cli.command {
        Commands::CreateWallet { name } => {
            debug!("Creating new wallet: {}", name);
            let wallet = mercuryrustlib::wallet::create_wallet(&name, &client_config).await?;

            mercuryrustlib::sqlite_manager::insert_wallet(&client_config.pool, &wallet).await?;
            
            // Beautiful output for wallet creation
            println!("✅ Wallet '{}' created successfully!", name);
            println!();
            println!("📁 Wallet Details:");
            println!("   Name: {}", wallet.name);
            
            info!("Wallet '{}' created successfully", name);
        }
        Commands::NewToken {} => {
            info!("Requesting new token from statechain entity");
            let token_response = mercuryrustlib::deposit::get_token(&client_config).await?;

            let obj = json!(token_response);
            info!("Token received successfully");

            println!("{}", serde_json::to_string_pretty(&obj).unwrap());
        }
        Commands::NewDepositAddress {
            wallet_name,
            token_id,
            amount,
        } => {
            debug!("Generating new deposit address for wallet '{}', amount: {}, token: {}", 
                  wallet_name, amount, token_id);
            let address = mercuryrustlib::deposit::get_deposit_bitcoin_address(
                &client_config,
                &wallet_name,
                &token_id,
                amount,
            )
            .await?;

            // Beautiful output for deposit address
            println!("💰 New Deposit Address Generated");
            println!();
            println!("📧 Address: {}", address);
            println!("💼 Wallet: {}", wallet_name);
            println!("💵 Amount: {} sats", amount);
            println!("🎟️  Token: {}", token_id);
            println!();
            
            info!("Deposit address generated for wallet '{}'", wallet_name);
        }
        Commands::BroadcastBackupTransaction {
            wallet_name,
            statechain_id,
            to_address,
            fee_rate,
        } => {
            mercuryrustlib::coin_status::update_coins(&client_config, &wallet_name).await?;
            mercuryrustlib::broadcast_backup_tx::execute(
                &client_config,
                &wallet_name,
                &statechain_id,
                to_address,
                fee_rate,
            )
            .await?;
        }
        Commands::ListStatecoins { wallet_name } => {
            debug!("Updating coin status for wallet: {}", wallet_name);
            mercuryrustlib::coin_status::update_coins(&client_config, &wallet_name).await?;
            let wallet =
                mercuryrustlib::sqlite_manager::get_wallet(&client_config.pool, &wallet_name)
                    .await?;

            // Beautiful output for listing statecoins
            println!("💼 Wallet: {}", wallet_name);
            println!("🪙 Statecoins ({} coins)", wallet.coins.len());
            println!("{}", "═".repeat(80));
            
            if wallet.coins.is_empty() {
                println!("   No statecoins found in this wallet");
                println!();
                return Ok(());
            }

            for (i, coin) in wallet.coins.iter().enumerate() {
                println!("🪙 Coin #{}", i + 1);
                println!("   📋 Statechain ID: {}", coin.statechain_id.as_ref().unwrap_or(&"N/A".to_string()));
                println!("   💰 Amount: {} sats", coin.amount.unwrap_or(0));
                println!("   📍 Status: {}", coin.status);
                println!("   🏠 Address: {}", coin.address);
                if let Some(agg_addr) = &coin.aggregated_address {
                    if !agg_addr.is_empty() {
                        println!("   🏢 Aggregated Address: {}", agg_addr);
                    }
                }
                println!("   ⏰ Locktime: {}", coin.locktime.unwrap_or(0));
                println!("   🔑 User Pubkey: {}", coin.user_pubkey);
                
                if i < wallet.coins.len() - 1 {
                    println!("   {}", "─".repeat(60));
                }
            }
            println!("{}", "═".repeat(80));
            println!();
            
            info!("Listed {} coins for wallet '{}'", wallet.coins.len(), wallet_name);
        }
        Commands::Withdraw {
            wallet_name,
            statechain_id,
            to_address,
            fee_rate,
            duplicated_index,
        } => {
            mercuryrustlib::coin_status::update_coins(&client_config, &wallet_name).await?;
            mercuryrustlib::withdraw::execute(
                &client_config,
                &wallet_name,
                &statechain_id,
                &to_address,
                fee_rate,
                duplicated_index,
            )
            .await?;
        }
        Commands::NewTransferAddress {
            wallet_name,
            generate_batch_id,
        } => {
            debug!("Generating new transfer address for wallet: {}", wallet_name);
            let address = mercuryrustlib::transfer_receiver::new_transfer_address(
                &client_config,
                &wallet_name,
            )
            .await?;

            // Beautiful output for new transfer address
            println!("🔗 New Transfer Address Generated");
            println!();
            println!("📧 Address: {}", address);
            println!("💼 Wallet: {}", wallet_name);

            if generate_batch_id {
                let batch_id = uuid::Uuid::new_v4().to_string();
                println!("🆔 Batch ID: {}", batch_id);
            }
            println!();
            
            info!("Transfer address generated for wallet '{}'", wallet_name);
        }
        Commands::TransferSend {
            wallet_name,
            statechain_id,
            to_address,
            force_send,
            batch_id,
            duplicated_indexes,
        } => {
            mercuryrustlib::coin_status::update_coins(&client_config, &wallet_name).await?;

            let force_send = force_send.unwrap_or(false);

            mercuryrustlib::transfer_sender::execute(
                &client_config,
                &to_address,
                &wallet_name,
                &statechain_id,
                duplicated_indexes,
                force_send,
                batch_id,
            )
            .await?;

            let obj = json!({"Transfer": "sent"});

            println!("{}", serde_json::to_string_pretty(&obj).unwrap());
        }
        Commands::TransferReceive { wallet_name } => {
            mercuryrustlib::coin_status::update_coins(&client_config, &wallet_name).await?;

            let mut received_statechain_ids = Vec::<String>::new();

            loop {
                let transfer_receive_result =
                    mercuryrustlib::transfer_receiver::execute(&client_config, &wallet_name)
                        .await?;
                received_statechain_ids.extend(transfer_receive_result.received_statechain_ids);

                if transfer_receive_result.is_there_batch_locked {
                    println!("Statecoin batch still locked. Waiting until expiration or unlock.");
                    thread::sleep(Duration::from_secs(5));
                } else {
                    break;
                }
            }

            let obj = json!(received_statechain_ids);

            println!("{}", serde_json::to_string_pretty(&obj).unwrap());
        }
        Commands::PaymentHash {
            wallet_name,
            statechain_id,
        } => {
            let response = mercuryrustlib::lightning_latch::create_pre_image(
                &client_config,
                &wallet_name,
                &statechain_id,
            )
            .await?;

            let obj = json!(response);

            println!("{}", serde_json::to_string_pretty(&obj).unwrap());
        }
        Commands::ConfirmPendingInvoice {
            wallet_name,
            statechain_id,
        } => {
            mercuryrustlib::lightning_latch::confirm_pending_invoice(
                &client_config,
                &wallet_name,
                &statechain_id,
            )
            .await?;
        }
        Commands::RetrievePreImage {
            wallet_name,
            statechain_id,
            batch_id,
        } => {
            let pre_image = mercuryrustlib::lightning_latch::retrieve_pre_image(
                &client_config,
                &wallet_name,
                &statechain_id,
                &batch_id,
            )
            .await?;

            let obj = json!({"pre_image": pre_image});

            println!("{}", serde_json::to_string_pretty(&obj).unwrap());
        }
        Commands::GetPaymentHash { batch_id } => {
            let payment_hash =
                mercuryrustlib::lightning_latch::get_payment_hash(&client_config, &batch_id)
                    .await?;

            let obj = json!({"payment_hash": payment_hash});

            println!("{}", serde_json::to_string_pretty(&obj).unwrap());
        }
    }

    debug!("Command completed successfully");
    debug!("Closing database connection");
    client_config.pool.close().await;
    debug!("Mercury Layer client terminated");

    Ok(())
}
