let { ethers, getDefaultProvider } = require('ethers')
let { EthersAdapter, SafeFactory } = require('@safe-global/protocol-kit')
let Safe = require('@safe-global/protocol-kit').default
let { AptosAccount, BCS, AptosClient, HexString, TxnBuilderTypes } = require("aptos")
const dotenv = require("dotenv")
dotenv.config()

const client = new AptosClient(process.env.MOVEMENT_RPC_ENDPOINT);
let pk = process.env.MOVE_PRIVATE_KEY;
let owner = new AptosAccount(new HexString(pk).toUint8Array())
let other = process.env.MOVE_MULTISIG_OTHER_OWNER_ADDR

let SafeApiKit = require('@safe-global/api-kit')
const web3Provider = process.env.EVM_RPC_ENDPOINT
const provider = getDefaultProvider(web3Provider)
const wallet = new ethers.Wallet(process.env.ETHEREUM_PRIVATE_KEY, provider);
let safeSDK;

const ethAdapterOwner1 = new EthersAdapter({
    ethers,
    signerOrProvider: wallet
})

// Initialize SafeService with the chainId and txServiceUrl from environment variables
const safeService = new SafeApiKit.default({
    chainId: 336n, // set the correct chainId
    txServiceUrl: process.env.SAFE_SERVICE_API
})

// Function to vote on a safe contract
async function vote(safeAddress, multiAccount) {
    await checkSafeContractVoted(safeAddress, multiAccount)
    let SAFE_ABI = [
        "function vote(bytes32 multisignAccount, uint64 sequence_number, bool approve)",
    ];
    let PRECOMPILE_ABI = [
        "function callMove(bytes32 account, bytes memory data)"

    ]
    let safeInterface = new ethers.utils.Interface(SAFE_ABI);
    let precompileInterface = new ethers.utils.Interface(PRECOMPILE_ABI);
    safeSDK = await Safe.create({ ethAdapter: ethAdapterOwner1, safeAddress })

    // 1.encode the predefine vote calldata
    // function vote(bytes32 multisignAccount, uint sequenceNumber, bool approve)
    let calldata = safeInterface.encodeFunctionData("vote", [multiAccount, 1, true]);

    // 2.encode the callMove function
    let txdata = precompileInterface.encodeFunctionData("callMove", [process.env.MOVE_FRAMEWORK, calldata])
    let safeTransactionData = {
        to: process.env.EVM_PRECOMPILE_CONTRACT,
        data: txdata,
        value: 0
    }

    // 3.create a safe transaction
    const safeTransaction = await safeSDK.createTransaction({ safeTransactionData })
    // 4. sign the safe tx
    console.log("sign the safe tx");
    const safeTxHash = await safeSDK.getTransactionHash(safeTransaction)
    const senderSignature = await safeSDK.signTransactionHash(safeTxHash)
    // 5. send the safe tx to the api kit
    console.log(`propose safe tx ${safeTxHash} using api kit`);
    await safeService.proposeTransaction({
        safeAddress,
        safeTransactionData: safeTransaction.data,
        safeTxHash,
        senderAddress: await wallet.getAddress(),
        senderSignature: senderSignature.data,
    })

    console.log(`confirm safe tx ${safeTxHash} using api kit`)
    await safeService.confirmTransaction(safeTxHash, senderSignature.data)
    // 6. execute the safe tx
    console.log(`execute safe tx ${safeTxHash} send to the evm`);
    const executeTxResponse = await safeSDK.executeTransaction(safeTransaction)
    await executeTxResponse.transactionResponse?.wait()

    console.log(`Transaction executed`);
    await checkSafeContractVoted(safeAddress, multiAccount)
}

// Function to deploy a new safe contract
async function deploySafe() {
    // Deploy a Safe contract with the provided parameters
    console.log("config a gnosis safe account");
    const safeAccountConfig = {
        owners: [
            await wallet.getAddress()
        ],
        threshold: 1
        // ... (Optional params)
    }

    const safeFactory = await SafeFactory.create({ ethAdapter: ethAdapterOwner1 })
    console.log("deploy a gnosis safe contract");
    safeSDK = await safeFactory.deploySafe({ safeAccountConfig, saltNonce: parseInt(Math.random() * 1e8) })
    const safeAddress = await safeSDK.getAddress()
    console.log(`gnosis safe address: ${safeAddress}`)
    return safeAddress
}

// Function to setup a new Move multisig account
async function setupMoveMultisigAccount(safeAddress) {
    let payload = {
        function: `0x1::multisig_account::get_next_multisig_account_address`,
        type_arguments: [],
        arguments: [owner.address().toString()],
    };
    let multisigAddress = (await client.view(payload))[0];

    console.log(`create multisig account ${multisigAddress}`);
    let rawTxn = await client.generateTransaction(owner.address(), {
        function: `0x1::multisig_account::create_with_owners`,
        type_arguments: [],
        arguments: [[TxnBuilderTypes.AccountAddress.fromHex(safeAddress)], 2, [], []],
    });

    console.log(`create multisig account tx ${await submitTx(rawTxn)}`);
    const multi_payload = new TxnBuilderTypes.MultiSigTransactionPayload(
        TxnBuilderTypes.EntryFunction.natural(
            "0x1::aptos_account",
            "0x1::multisig_account::add_owner",
            [],
            [BCS.bcsToBytes(TxnBuilderTypes.AccountAddress.fromHex(other))],
        ),
    );

    let createTxn = await client.generateTransaction(owner.address(), {
        function: `0x1::multisig_account::create_transaction`,
        type_arguments: [],
        arguments: [multisigAddress, BCS.bcsToBytes(multi_payload)],
    });

    console.log(`create multisig tx ${await submitTx(createTxn)}`);
    return multisigAddress
}

// Function to check if a safe contract has voted
async function checkSafeContractVoted(safeAddress, multiAccount) {
    let payload = {
        function: `0x1::multisig_account::vote`,
        type_arguments: [],
        arguments: [multiAccount, "1", safeAddress],
    };
    let result = await client.view(payload);

    console.log(`safe contract voted on move multisig proposal: ${result[1]}`)
}

// Function to submit a transaction
async function submitTx(rawTxn) {
    const bcsTxn = await client.signTransaction(owner, rawTxn);
    let result = await client.simulateTransaction(owner, rawTxn);
    const pendingTxn = await client.submitTransaction(bcsTxn);
    await client.waitForTransaction(pendingTxn.hash)
    return pendingTxn.hash;
}

// Function to pad the multiAccount address with zeroes
function zeroPad(multiAccount) {
    return "0x" + '0'.repeat(66 - multiAccount.length) + multiAccount.slice(2)
}

// Main function to run the script
async function run() {
    let safeAddress = await deploySafe()
    let multiAccount = zeroPad(await setupMoveMultisigAccount(safeAddress))
    await vote(safeAddress, multiAccount)
}

run().then()