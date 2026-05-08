pub mod broadcast_backup_tx;
pub mod client_config;
pub mod coin_status;
pub mod deposit;
pub mod lightning_latch;
pub mod split;
pub mod sqlite_manager;
pub mod transaction;
pub mod transfer_receiver;
pub mod transfer_sender;
pub mod utils;
pub mod wallet;
pub mod withdraw;

pub use mercurylib::{
    decode_transfer_address,
    deposit::TokenResponse,
    split::{
        BranchTxProof, LeafProof, SplitAbortRequest, SplitAbortResponse, SplitChild,
        SplitFinalizeRequest, SplitFinalizeResponse, SplitInitChild, SplitInitRequest,
        SplitInitResponse, StatechainTreeResponse, build_unsigned_branch_tx,
    },
    transaction::{SignFirstRequestPayload, SignFirstResponsePayload, create_and_commit_nonces},
    transfer::sender::{
        TransferSenderRequestPayload, TransferSenderResponsePayload, create_transfer_signature,
        create_transfer_update_msg,
    },
    utils::get_blockheight,
    validate_address,
    wallet::{Activity, BackupTx, Coin, CoinStatus, Wallet, get_previous_outpoint},
};

pub fn add(left: usize, right: usize) -> usize {
    left + right
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn it_works() {
        let result = add(2, 2);
        assert_eq!(result, 4);
    }
}
