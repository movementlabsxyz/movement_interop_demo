module call_evm_demo::demo {
    use aptos_framework::evm::{MoveContractCap, register_move_contract, call_evm_from_move, get_nonce, get_evm_address};

    struct ModuleCap has key {
        cap: MoveContractCap
    }

    fun init_module(signer: &signer) {
        move_to(signer, ModuleCap {
            cap: register_move_contract(signer)
        });
    }

    public entry fun call_evm(to: vector<u8>, calldata: vector<u8>, value_bytes: vector<u8>) acquires ModuleCap {
        let cap = borrow_global_mut<ModuleCap>(@call_evm_demo);
        let nonce = get_nonce(get_evm_address(@call_evm_demo));
        call_evm_from_move(&cap.cap, nonce, to, calldata, value_bytes, 1);
    }
}
