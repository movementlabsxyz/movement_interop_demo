let { ethers, ContractFactory, getDefaultProvider } = require('ethers')
let { EthersAdapter, SafeFactory, ContractNetworksConfig} = require('@safe-global/protocol-kit')
let {AptosAccount, CoinClient, MoveView, BCS, AptosClient, HexString, TxnBuilderTypes} = require("aptos")
const dotenv = require("dotenv")
dotenv.config()

const client = new AptosClient(process.env.MOVEMENT_RPC_ENDPOINT);
let pk = process.env.MOVE_OWNER_PK;
let owner = new AptosAccount(new HexString(pk).toUint8Array())

const web3Provider = process.env.EVM_RPC_ENDPOINT
const provider = getDefaultProvider(web3Provider)
const wallet = new ethers.Wallet(process.env.EVM_OWNER_PK, provider);
const account = wallet.connect(provider);
const data = require("./Counter.json")

async function deployCounter() {
	const factory = new ContractFactory(data.abi, data.bytecode, account);
	const contract = await factory.deploy();
	console.log(`counter deployed at ${contract.address}`)

	return contract
}

// Function to submit a transaction
async function submitTx(rawTxn) {
    const bcsTxn = await client.signTransaction(owner, rawTxn);
    let result = await client.simulateTransaction(owner, rawTxn);
    const pendingTxn = await client.submitTransaction(bcsTxn);
    await client.waitForTransaction(pendingTxn.hash)
    return pendingTxn.hash;
}

// Function to get the nonce of an account
async function getNonce(addr) {
    try {
		let resource = await client.getAccountResource("0x" + addr.toString().slice(26), `0x1::evm::Account`);
		return parseInt(resource.data.nonce);
	} catch (e) {
		// return 0 if account not created
		return 0;
	}
}

// Function to set the number
async function setNumber(contract) {
	let iface = new ethers.utils.Interface(data.abi);
	let calldata = iface.encodeFunctionData("setNumber", [100]);

	let nonce = await getNonce(owner.address())
	let txn = await client.generateTransaction(owner.address(), {
        function: `0x1::evm::send_move_tx_to_evm`,
        type_arguments: [],
        arguments: [nonce, new HexString(contract.address).toUint8Array(), BCS.bcsSerializeU256(0), new HexString(calldata).toUint8Array(), 1],
    });
	
	console.log(`setting number tx ${await submitTx(txn)}`);
}

async function main() {
	await getNonce(owner.address())
	let contract = await deployCounter();
	let number = await contract.number();
	console.log(`number before setting ${number}`)
	await setNumber(contract)
	number = await contract.number();
	console.log(`number after setting ${number}`)
}

main().then()

