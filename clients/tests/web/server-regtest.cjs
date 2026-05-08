const express = require('express')
const bodyParser = require('body-parser')
const app = express()
const cors = require('cors')
const port = 3000
const util = require('node:util');
const exec = util.promisify(require('node:child_process').exec);
const lightningPayReq = require('bolt11');

app.use(bodyParser.json())
app.use(cors())

const bitcoinWalletName = 'mercury-regtest'

async function bitcoinCli(args, useWallet = true) {
  const walletArg = useWallet ? `-rpcwallet=${bitcoinWalletName} ` : ''
  const command = `docker exec $(docker ps -qf "name=esplora-container") cli ${walletArg}${args}`
  return await exec(command)
}

async function ensureBitcoinWallet() {
  try {
    await bitcoinCli('getwalletinfo')
  } catch {
    try {
      await bitcoinCli(`loadwallet ${bitcoinWalletName}`, false)
    } catch {
      await bitcoinCli(`createwallet ${bitcoinWalletName}`, false)
    }
  }
}

async function getnewaddress() {
  await ensureBitcoinWallet()
  const { stdout, stderr } = await bitcoinCli('getnewaddress');
  if (stderr) {
    throw new Error(`Error: ${stderr}`);
  }
  return stdout.trim();
}

async function generateBlocks(numBlocks) {
  if (numBlocks === 0) {
    await ensureBitcoinWallet()
    return
  }

  const address = await getnewaddress();
  await bitcoinCli(`generatetoaddress ${numBlocks} ${address}`);
}

async function ensureSpendableFunds(requiredSats) {
  await ensureBitcoinWallet()

  const { stdout } = await bitcoinCli('getbalance')
  const balanceBtc = Number(stdout.trim())
  const requiredBtc = requiredSats / 100000000

  if (Number.isFinite(balanceBtc) && balanceBtc >= requiredBtc) {
    return
  }

  await generateBlocks(101)
}

async function depositCoin(amount, address) {
  await ensureBitcoinWallet()
  await ensureSpendableFunds(amount)
  const amountInBtc = amount / 100000000;
  await bitcoinCli(`sendtoaddress ${address} ${amountInBtc}`);
}

const generateInvoice = async (paymentHash, amountInSats) => {
  const generateInvoiceCommand = `docker exec $(docker ps -qf "name=mercurylayer-alice-1") lncli -n regtest addholdinvoice ${paymentHash} --amt ${amountInSats}`;

  const { stdout, stderr } = await exec(generateInvoiceCommand);
  if (stderr) {
      console.error('Error:', stderr);
      return null;
  }
  return stdout.trim();
}

const payInvoice = async (paymentRequest) => {
  const payInvoiceCommand = `docker exec $(docker ps -qf "name=mercurylayer-bob-1") lncli -n regtest payinvoice --force ${paymentRequest}`;
  await exec(payInvoiceCommand);
}

const payHoldInvoice = (paymentRequest) => {
  const payInvoiceCommand = `docker exec $(docker ps -qf "name=mercurylayer-bob-1") lncli -n regtest payinvoice --force ${paymentRequest}`;
  exec(payInvoiceCommand);
}

const settleInvoice = async (preimage) => {
  const settleInvoiceCommand = `docker exec $(docker ps -qf "name=mercurylayer-alice-1") lncli -n regtest settleinvoice ${preimage}`;
  await exec(settleInvoiceCommand);
}

app.post('/deposit_amount', async (req, res) => {
  const { address, amount } = req.body

  if (typeof address === 'string' && Number.isInteger(amount)) {
    try {
      console.log(`Deposit received: Address - ${address}, Amount - ${amount}`)
      await depositCoin(amount, address)
      res.status(200).send({ message: 'Deposit processed successfully' })
    } catch (error) {
      console.log(error.message)
      res.status(500).send({ message: error.message })
    }
  } else {
    res.status(400).send({ message: 'Invalid input' })
  }
})

app.get('/health', async (req, res) => {
  try {
    await ensureBitcoinWallet()
    res.status(200).send({ ok: true })
  } catch (error) {
    res.status(500).send({ ok: false, message: error.message })
  }
})

app.get('/new_address', async (req, res) => {
  try {
    const address = await getnewaddress()
    res.status(200).send({ address })
  } catch (error) {
    console.log(error.message)
    res.status(500).send({ message: error.message })
  }
})

app.post('/generate_blocks', async (req, res) => {
  const { blocks } = req.body

  if (Number.isInteger(blocks)) {
    // Process the deposit here
    console.log(`Generating ${blocks} blocks ...`)
    
    try {
      await generateBlocks(blocks);
    } catch (error) {
      console.log(error.message);
      res.status(500).send({ message: error.message })
    } 
    
    res.status(200).send({ message: 'Blocks generated successfully' })
  } else {
    res.status(400).send({ message: 'Invalid input' })
  }
})

app.post('/generate_invoice', async (req, res) => {
  const { paymentHash, amountInSats } = req.body

  if (typeof paymentHash === 'string' && Number.isInteger(amountInSats)) {
    console.log(`Generating invoice ...`)
    
    try {
      const invoice = await generateInvoice(paymentHash, amountInSats);
      res.status(200).send({ message: 'Invoice generated successfully', invoice })
    } catch (error) {
      console.log(error.message);
      res.status(500).send({ message: error.message })
    } 
    
  } else {
    res.status(400).send({ message: 'Invalid input' })
  }
})

app.post('/pay_invoice', async (req, res) => {
  const { paymentRequest } = req.body

  if (typeof paymentRequest === 'string') {
    console.log(`Paying invoice ...`)
    
    try {
      await payInvoice(paymentRequest);
    } catch (error) {
      console.log(error.message);
      res.status(500).send({ message: error.message })
    } 
    
    res.status(200).send({ message: 'Invoice paid successfully' })
  } else {
    res.status(400).send({ message: 'Invalid input' })
  }
})

app.post('/pay_holdinvoice', async (req, res) => {
  const { paymentRequest } = req.body

  if (typeof paymentRequest === 'string') {
    console.log(`Paying invoice ...`)
    
    try {
      payHoldInvoice(paymentRequest);
    } catch (error) {
      console.log(error.message);
      res.status(500).send({ message: error.message })
    } 
    
    res.status(200).send({ message: 'Invoice paid successfully' })
  } else {
    res.status(400).send({ message: 'Invalid input' })
  }
})

app.post('/settle_invoice', async (req, res) => {
  const { preimage } = req.body

  if (typeof preimage === 'string') {
    console.log(`Settling invoice ...`)
    
    try {
      await settleInvoice(preimage);
    } catch (error) {
      console.log(error.message);
      res.status(500).send({ message: error.message })
    } 
    
    res.status(200).send({ message: 'Invoice settled successfully' })
  } else {
    res.status(400).send({ message: 'Invalid input' })
  }
})

app.post('/decode_invoice', async (req, res) => {
  const { paymentRequest } = req.body

  if (typeof paymentRequest === 'string') {
    console.log(`Decoding invoice ...`)
    
    try {
      const invoice = lightningPayReq.decode(paymentRequest);
      res.status(200).send({ message: 'Invoice generated successfully', invoice })
    } catch (error) {
      console.log(error.message);
      res.status(500).send({ message: error.message })
    } 
    
  } else {
    res.status(400).send({ message: 'Invalid input' })
  }
})

app.listen(port, () => {
  console.log(`Docker server listening on port ${port}`)
})
