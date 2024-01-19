let { ethers, ContractFactory, getDefaultProvider } = require('ethers')
let { EthersAdapter, SafeFactory, ContractNetworksConfig } = require('@safe-global/protocol-kit')
let { AptosAccount, CoinClient, MoveView, BCS, AptosClient, HexString, TxnBuilderTypes } = require("aptos")
const dotenv = require("dotenv")
dotenv.config()

const client = new AptosClient(process.env.MOVEMENT_RPC_ENDPOINT);
let pk = process.env.MOVE_PRIVATE_KEY;
let owner = new AptosAccount(new HexString(pk).toUint8Array())

const fs = require("fs");
const path = require("path");

const web3Provider = process.env.EVM_RPC_ENDPOINT
const provider = getDefaultProvider(web3Provider)
const wallet = new ethers.Wallet(process.env.ETHEREUM_PRIVATE_KEY, provider);
const account = wallet.connect(provider);
const data = require("./NumberRegistry.json")
const moveModule = "./move-contract";

async function deployNumberRegistry() {
	const factory = new ContractFactory(data.abi, data.bytecode, account);
	const contract = await factory.deploy();
	console.log(`NumberRegistry deployed at ${contract.address}`)

	return contract
}

async function deployMovePackage() {
	const moduleData = fs.readFileSync(path.join(moveModule, "build", "CallEVMDemo", "bytecode_modules", "demo.mv"));
	const packageMetadata = fs.readFileSync(path.join(moveModule, "build", "CallEVMDemo", "package-metadata.bcs"));
	let txnHash = await client.publishPackage(owner, new HexString(packageMetadata.toString("hex")).toUint8Array(), [
		new TxnBuilderTypes.Module(new HexString(moduleData.toString("hex")).toUint8Array()),
	]);
	await client.waitForTransaction(txnHash, { checkSuccess: true });
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

async function setNumberByMoveContract(contract) {
	let interface = new ethers.utils.Interface(data.abi);

	// 1. Encodes the EVM function
	let calldata = interface.encodeFunctionData("setNumber", [200]);

	// 2. Generates the AptosVM transaction that interacts with the EVM contract
	let txn = await client.generateTransaction(owner.address(), {
		function: `${owner.address()}::demo::call_evm`,
		type_arguments: [],
		arguments: [new HexString(contract.address).toUint8Array(), new HexString(calldata).toUint8Array(), BCS.bcsSerializeU256(0)],
	});

	console.log(`setting number tx ${await submitTx(txn)}`);
}

// Function to set the number
async function setNumberByWallet(contract) {
	let interface = new ethers.utils.Interface(data.abi);
	
	// 1. Encodes the EVM function
	let calldata = interface.encodeFunctionData("setNumber", [100]);

	// 2. Gets the AptosVM Account EVM nonce
	let nonce = await getNonce(owner.address())

	// 3. Generates the AptosVM transaction that interacts with the EVM contract
	let txn = await client.generateTransaction(owner.address(), {
		function: `0x1::evm::send_move_tx_to_evm`,
		type_arguments: [],
		arguments: [nonce, new HexString(contract.address).toUint8Array(), BCS.bcsSerializeU256(0), new HexString(calldata).toUint8Array(), 1],
	});

	console.log(`setting number tx ${await submitTx(txn)}`);
}

async function run() {
	let contract = await deployNumberRegistry();
	let number = await contract.number();
	console.log(`number before setting ${number}`)
	await setNumberByWallet(contract)
	number = await contract.number();
	console.log(`number after setting by wallet ${number}`)

	await deployMovePackage(); // only need to deploy once
	await setNumberByMoveContract(contract);
	number = await contract.number();
	console.log(`number after setting by contract ${number}`)

}

run().then()

