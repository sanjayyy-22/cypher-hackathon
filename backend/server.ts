import { PrismaClient } from '@prisma/client';
import axios from 'axios';
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

// Approve USD transfer (Skip API)
app.post('/api/transfer/approve-usd', async (req, res) => {
  try {
    const { from, to, usdAmount } = req.body;
    const wallet = await prisma.wallet.findUnique({ where: { address: from } });
    if (!wallet)
      return res.status(404).json({ error: 'Sender wallet not found' });

    const usdcAmount = readableToUsdc(usdAmount);
    const skipResponse = await axios.post(
      'https://api.skip.build/v2/fungible/msgs_direct',
      {
        source_asset_denom: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        source_asset_chain_id: '1',
        dest_asset_denom: 'ethereum-native',
        dest_asset_chain_id: '1',
        amount_in: usdcAmount,
        chain_ids_to_addresses: {
          1: '0x742d35Cc6634C0532925a3b8D4C9db96c728b0B4',
        },
        slippage_tolerance_percent: '1',
        smart_swap_options: { evm_swaps: true },
        allow_unsafe: false,
      },
      { headers: { Authorization: `Bearer ${process.env.SKIP_API_KEY}` } }
    );

    const ethAmountWei = skipResponse.data.amount_out;
    if (BigInt(wallet.balance) < BigInt(ethAmountWei))
      return res.status(400).json({ error: 'Insufficient balance' });

    const expiresAt = Date.now() + 30000;
    const message = `Transfer ${weiToEth(
      ethAmountWei
    )} ETH ($${usdAmount} USD) to ${to} from ${from}. Expires: ${expiresAt}`;

    res.json({
      message,
      expiresAt,
      ethAmount: weiToEth(ethAmountWei),
      ethAmountWei,
      usdAmount,
      originalQuote: ethAmountWei,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Execute transfer
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
    const recovered = ethers.verifyMessage(message, signature);
    if (recovered.toLowerCase() !== from.toLowerCase())
      return res.status(401).json({ error: 'Invalid signature' });

    const expiresAt = parseInt(message.split('Expires: ')[1]);
    if (Date.now() > expiresAt)
      return res.status(400).json({ error: 'Transaction expired' });

    let amountWei = isUsd ? originalQuote : ethToWei(amount).toString();
    const senderWallet = await prisma.wallet.findUnique({
      where: { address: from },
    });
    if (!senderWallet)
      return res.status(404).json({ error: 'Sender wallet not found' });
    if (BigInt(senderWallet.balance) < BigInt(amountWei))
      return res.status(400).json({ error: 'Insufficient balance' });

    let recipientWallet = await prisma.wallet.findUnique({
      where: { address: to },
    });
    if (!recipientWallet)
      recipientWallet = await prisma.wallet.create({
        data: { address: to, balance: '0' },
      });

    await prisma.wallet.update({
      where: { address: from },
      data: {
        balance: (BigInt(senderWallet.balance) - BigInt(amountWei)).toString(),
      },
    });
    await prisma.wallet.update({
      where: { address: to },
      data: {
        balance: (
          BigInt(recipientWallet.balance) + BigInt(amountWei)
        ).toString(),
      },
    });

    const tx = await prisma.transaction.create({
      data: {
        from,
        to,
        amount,
        amountWei,
        usdAmount: isUsd ? usdAmount : null,
        signature,
      },
    });

    res.json({
      success: true,
      transaction: tx,
      newBalance: weiToEth(
        (BigInt(senderWallet.balance) - BigInt(amountWei)).toString()
      ),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Transaction history
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
