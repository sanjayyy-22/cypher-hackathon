import { PrismaClient } from '@prisma/client';
import cors from 'cors';
import { ethers } from 'ethers';
import express from 'express';
import nodemailer from 'nodemailer';

const app = express();
const prisma = new PrismaClient();
app.use(cors());
app.use(express.json());

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

const ethToWei = (eth: string) => ethers.parseEther(eth);
const weiToEth = (wei: string) => ethers.formatEther(wei);
const readableToUsdc = (amount: string) =>
  Math.floor(Number(amount) * 1e6).toString();

app.post('/api/wallet/set-email', async (req, res) => {
  try {
    const { address, email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email required' });

    const wallet = await prisma.wallet.update({
      where: { address },
      data: { email },
    });

    res.json({ success: true, email: wallet.email });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Create / init wallet
app.post('/api/wallet/init', async (req, res) => {
  try {
    const { address, email } = req.body;
    let wallet = await prisma.wallet.findUnique({ where: { address } });

    if (!wallet) {
      const randomBalance = (Math.random() * 9 + 1).toFixed(4);
      wallet = await prisma.wallet.create({
        data: {
          address,
          balance: ethToWei(randomBalance).toString(),
          email: email || null,
        },
      });
    }

    res.json({
      address: wallet.address,
      balance: weiToEth(wallet.balance),
      balanceWei: wallet.balance,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Get wallet balance
app.get('/api/wallet/:address', async (req, res) => {
  try {
    const wallet = await prisma.wallet.findUnique({
      where: { address: req.params.address },
    });
    if (!wallet) return res.status(404).json({ error: 'Wallet not found' });
    res.json({
      address: wallet.address,
      balance: weiToEth(wallet.balance),
      balanceWei: wallet.balance,
      email: wallet.email,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Approve ETH transfer
app.post('/api/transfer/approve-eth', async (req, res) => {
  try {
    const { from, to, amount } = req.body;
    if (!amount) throw new Error('Amount required');

    const wallet = await prisma.wallet.findUnique({ where: { address: from } });
    if (!wallet)
      return res.status(404).json({ error: 'Sender wallet not found' });

    const amountWei = ethToWei(amount);
    if (BigInt(wallet.balance) < BigInt(amountWei))
      return res.status(400).json({ error: 'Insufficient balance' });

    const expiresAt = Date.now() + 30000;
    const message = `Transfer ${amount} ETH to ${to} from ${from}. Expires: ${expiresAt}`;
    res.json({ message, expiresAt, amount, amountWei: amountWei.toString() });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/transfer/approve-usd', async (req, res) => {
  const { from, to, amount, currency } = req.body;

  let ethAmount = amount;

  if (currency === 'USD') {
    const skipResponse = await fetch(
      'https://api.skip.build/v2/fungible/msgs_direct',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source_asset_denom: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', // USDC
          source_asset_chain_id: '1',
          dest_asset_denom: 'ethereum-native',
          dest_asset_chain_id: '1',
          amount_in: amount,
          chain_ids_to_addresses: { '1': to },
          slippage_tolerance_percent: '1',
          smart_swap_options: { evm_swaps: true },
          allow_unsafe: false,
        }),
      }
    );
    const data = await skipResponse.json();
    ethAmount = data.amount_out;
  }

  const approvalMessage = `Transfer ${ethAmount} ETH (${
    currency === 'USD' ? `$${amount}` : ''
  }) to ${to} from ${from}`;

  res.json({ message: approvalMessage, amount: ethAmount });
});

app.post('/api/transfer/execute', async (req, res) => {
  try {
    const {
      from,
      to,
      amount,
      signature,
      message,
      isUsd,
      originalQuote,
      usdAmount,
    } = req.body;

    // Validate basic input
    if (!from || !to) {
      return res
        .status(400)
        .json({ error: 'From and To addresses are required' });
    }
    if (!amount && !isUsd) {
      return res
        .status(400)
        .json({ error: 'Amount required for ETH transfer' });
    }

    // Verify signature
    const recovered = ethers.verifyMessage(message, signature);
    if (recovered.toLowerCase() !== from.toLowerCase()) {
      return res.status(401).json({ error: 'Invalid signature' });
    }

    // Check expiration
    const expiresAtStr = message.split('Expires: ')[1];
    if (!expiresAtStr)
      return res.status(400).json({ error: 'Invalid message format' });
    const expiresAt = parseInt(expiresAtStr);
    if (Date.now() > expiresAt)
      return res.status(400).json({ error: 'Transaction expired' });

    // Determine amount in wei safely
    let amountWei: bigint;

    if (isUsd) {
      if (!originalQuote)
        return res
          .status(400)
          .json({ error: 'Original quote missing for USD transfer' });
      try {
        amountWei = BigInt(originalQuote);
      } catch {
        return res.status(400).json({ error: 'Invalid originalQuote value' });
      }
    } else {
      const parsedAmount = parseFloat(amount);
      if (isNaN(parsedAmount) || parsedAmount <= 0) {
        return res.status(400).json({ error: 'Invalid ETH amount' });
      }
      amountWei = ethers.parseEther(parsedAmount.toString());
    }

    // Fetch sender wallet
    const senderWallet = await prisma.wallet.findUnique({
      where: { address: from },
    });
    if (!senderWallet)
      return res.status(404).json({ error: 'Sender wallet not found' });

    // Check sender balance
    if (BigInt(senderWallet.balance) < amountWei) {
      return res.status(400).json({ error: 'Insufficient balance' });
    }

    // Fetch or create recipient wallet
    let recipientWallet = await prisma.wallet.findUnique({
      where: { address: to },
    });
    if (!recipientWallet) {
      recipientWallet = await prisma.wallet.create({
        data: { address: to, balance: '0' },
      });
    }

    // Update balances
    await prisma.wallet.update({
      where: { address: from },
      data: { balance: (BigInt(senderWallet.balance) - amountWei).toString() },
    });

    await prisma.wallet.update({
      where: { address: to },
      data: {
        balance: (BigInt(recipientWallet.balance) + amountWei).toString(),
      },
    });

    // Save transaction
    const tx = await prisma.transaction.create({
      data: {
        from,
        to,
        amount,
        amountWei: amountWei.toString(),
        usdAmount: isUsd ? usdAmount : null,
        signature,
      },
    });

    console.log('Transaction executed:', req.body);

    // Send email notification if sender has email
    if (senderWallet.email) {
      await transporter.sendMail({
        from: `'Cypher' <${process.env.BREVO_SMTP_USER}>`,
        to: senderWallet.email,
        subject: 'Transaction Successful',
        text: `You sent ${amount} ${isUsd ? 'USD' : 'ETH'} to ${to}.`,
      });
    }

    // Respond with success
    res.json({
      success: true,
      transaction: tx,
      newBalance: ethers.formatEther(
        (BigInt(senderWallet.balance) - amountWei).toString()
      ),
    });
  } catch (err: any) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.post('/api/transfer/balance-usd', async (req, res) => {
  try {
    const { amount } = req.body; // USD amount
    if (!amount) throw new Error('Amount required');

    // Fetch current ETH price in USD
    const ethPriceRes = await fetch(
      'https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd'
    );
    const priceData = await ethPriceRes.json();
    const ethPrice = priceData.ethereum.usd;

    // Calculate ETH equivalent
    const ethAmount = Number(amount) / ethPrice;
    const ethAmountWei = ethers.parseEther(ethAmount.toString()).toString();

    res.json({ ethAmountWei });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/transactions/:address', async (req, res) => {
  try {
    const userTxs = await prisma.transaction.findMany({
      where: { OR: [{ from: req.params.address }, { to: req.params.address }] },
      orderBy: { timestamp: 'desc' },
    });
    res.json(userTxs);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Server running on ${PORT}`));
