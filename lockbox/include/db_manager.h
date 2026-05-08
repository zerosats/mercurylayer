#pragma once

#ifndef DB_MANAGER_H
#define DB_MANAGER_H

#include <memory>
#include <string>
#include <utility>
#include <vector>
#include "utils.h"

namespace db_manager {

    void serialize(const utils::chacha20_poly1305_encrypted_data* src, unsigned char* buffer, size_t* serialized_len);

    bool deserialize(const unsigned char* buffer, utils::chacha20_poly1305_encrypted_data* dest);

    bool save_generated_public_key(
        const utils::chacha20_poly1305_encrypted_data& encrypted_keypair, 
        unsigned char* server_public_key, size_t server_public_key_size,
        const std::string& statechain_id,
        std::string& error_message);

    bool load_generated_key_data(
        const std::string& statechain_id, 
        std::unique_ptr<utils::chacha20_poly1305_encrypted_data>& encrypted_keypair,
        std::unique_ptr<utils::chacha20_poly1305_encrypted_data>& encrypted_secnonce,
        unsigned char* public_nonce, const size_t public_nonce_size, 
        std::string& error_message);

    bool update_sealed_secnonce(
        const std::string& statechain_id, 
        unsigned char* serialized_server_pubnonce, const size_t serialized_server_pubnonce_size, 
        const utils::chacha20_poly1305_encrypted_data& encrypted_secnonce, 
        std::string& error_message);

    bool update_sig_count(const std::string& statechain_id);

    bool signature_count(const std::string& statechain_id, int& sig_count);

    bool update_sealed_keypair(
        const utils::chacha20_poly1305_encrypted_data& encrypted_keypair, 
        unsigned char* server_public_key, size_t server_public_key_size,
        const std::string& statechain_id,
        std::string& error_message);

    bool delete_statechain(const std::string& statechain_id);

    bool save_pending_split_child_key(
        const utils::chacha20_poly1305_encrypted_data& encrypted_keypair,
        unsigned char* server_public_key, size_t server_public_key_size,
        const std::string& statechain_id,
        const std::string& split_id,
        std::string& error_message);

    bool get_split_child_public_keys(
        const std::string& split_id,
        std::vector<std::pair<std::string, std::string>>& child_public_keys,
        std::string& error_message);

    bool finalize_split_keys(
        const std::string& split_id,
        const std::string& parent_statechain_id,
        std::string& error_message);

    bool abort_split_keys(
        const std::string& split_id,
        const std::string& parent_statechain_id,
        std::string& error_message);
}

#endif // DB_MANAGER_H
