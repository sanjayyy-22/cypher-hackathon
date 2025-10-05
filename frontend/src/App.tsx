import './App.css';

import { CheckCircle2, RefreshCw, Send, Wallet, XCircle } from 'lucide-react';
import React, { useEffect, useState } from 'react';

import { ethers } from 'ethers';

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001';

function walletFromMnemonic(phrase: string) {
  if (!phrase) throw new Error('Mnemonic required');
  return ethers.Wallet.fromPhrase(phrase);
}

export default function App() {
  const [mnemonic, setMnemonic] = useState('');
  type WalletWithEmail = ethers.HDNodeWallet & { email?: string | null };
  const [wallet, setWallet] = useState<WalletWithEmail | null>(null);
  const [balance, setBalance] = useState('0'); // ETH
  const [usdBalance, setUsdBalance] = useState('0'); // USD
  const [recipient, setRecipient] = useState('');
  const [amount, setAmount] = useState(''); // Always store in ETH internally
  const [approvalData, setApprovalData] = useState<any>(null);
  const [transactions, setTransactions] = useState<any[]>([]);
  const [currency, setCurrency] = useState<'eth' | 'usd'>('eth');
  const [emailInput, setEmailInput] = useState('');
  const [emailShow, setEmailShow] = useState(true);
  const [ethPrice, setEthPrice] = useState(0); // USD per ETH
  const [error, setError] = useState('');

  // Load wallet from localStorage
  useEffect(() => {
    const stored = localStorage.getItem('mnemonic');
    if (stored) {
      try {
        const w = walletFromMnemonic(stored);
        setMnemonic(stored);
        setWallet(w);
        fetchBalance(w.address);
        fetchHistory(w.address);
      } catch (err) {
        console.error(err);
      }
    }
  }, []);

  // Fetch ETH price in USD
  useEffect(() => {
    const fetchEthPrice = async () => {
      try {
        const res = await fetch(
          'https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd'
        );
        const data = await res.json();
        setEthPrice(data.ethereum.usd);
      } catch (err) {
        console.error(err);
      }
    };
    fetchEthPrice();
  }, []);

  // Update USD balance whenever ETH balance changes
  useEffect(() => {
    setUsdBalance((parseFloat(balance || '0') * ethPrice).toFixed(2));
  }, [balance, ethPrice]);

  const createWallet = async () => {
    try {
      const randomWallet = ethers.Wallet.createRandom();
      const phrase = randomWallet.mnemonic?.phrase;
      if (!phrase) throw new Error('Failed to create mnemonic');
      localStorage.setItem('mnemonic', phrase);
      setMnemonic(phrase);
      setWallet(randomWallet);
      await fetch(`${API_BASE}/api/wallet/init`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address: randomWallet.address }),
      });
      await fetchBalance(randomWallet.address);
      await fetchHistory(randomWallet.address);
    } catch (err: any) {
      setError(err.message || 'Create wallet failed');
    }
  };

  const importWallet = async () => {
    try {
      if (!mnemonic || mnemonic.trim().split(/\s+/).length < 12)
        throw new Error('Enter 12-word mnemonic');
      const imported = walletFromMnemonic(mnemonic.trim());
      setWallet(imported);
      localStorage.setItem('mnemonic', mnemonic.trim());
      await fetch(`${API_BASE}/api/wallet/init`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address: imported.address }),
      });
      await fetchBalance(imported.address);
      await fetchHistory(imported.address);
    } catch (err: any) {
      setError(err.message || 'Import wallet failed');
      alert(err.message);
    }
  };

  const fetchBalance = async (address: string) => {
    try {
      const res = await fetch(`${API_BASE}/api/wallet/${address}`);
      const data = await res.json();
      if (data?.error) throw new Error(data.error);
      setWallet((prev) =>
        prev
          ? Object.assign(prev, { email: data.email || null })
          : ({ address: data.address, email: data.email || null } as any)
      );
      setBalance(data.balance);
    } catch (err: any) {
      setError(err.message || 'Failed to fetch balance');
    }
  };

  const fetchHistory = async (address: string) => {
    try {
      const res = await fetch(`${API_BASE}/api/transactions/${address}`);
      const data = await res.json();
      setTransactions(Array.isArray(data) ? data : []);
    } catch (err: any) {
      setError(err.message || 'Failed to fetch history');
    }
  };

  // Convert USD input back to ETH for sending
  const sendAmount =
    currency === 'usd'
      ? (parseFloat(amount || '0') / ethPrice).toString()
      : amount;

  const requestApproval = async () => {
    try {
      if (!wallet) throw new Error('Load wallet first');
      if (!recipient) throw new Error('Recipient required');
      if (!amount || Number(amount) <= 0) throw new Error('Enter valid amount');

      const res = await fetch(`${API_BASE}/api/transfer/approve-${currency}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: wallet.address, to: recipient, amount }),
      });

      const data = await res.json();
      if (data?.error) throw new Error(data.error);

      // If USD, ensure ETH quote is included
      if (currency === 'usd') {
        if (!data.ethAmountWei) {
          // Fetch ETH quote for USD using your backend
          const quoteRes = await fetch(`${API_BASE}/api/transfer/balance-usd`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ to: wallet.address, amount }),
          });
          const quoteData = await quoteRes.json();
          if (quoteData.error) throw new Error(quoteData.error);
          data.ethAmountWei = quoteData.ethAmountWei;
        }
      }

      setApprovalData(data);
    } catch (err: any) {
      setError(err.message || 'Approval request failed');
      alert(err.message);
    }
  };

  const signAndExecute = async () => {
    try {
      if (!wallet) throw new Error('No wallet loaded');
      if (!approvalData) throw new Error('No approval data');
      if (!recipient) throw new Error('Recipient required');
      if (!sendAmount || Number(sendAmount) <= 0)
        throw new Error('Amount required');

      const expiresAt = Date.now() + 5 * 60 * 1000;
      const message = `Transfer from ${wallet.address} to ${recipient} Amount: ${sendAmount} ETH Expires: ${expiresAt}`;
      const signature = await wallet.signMessage(message);

      const payload = {
        from: wallet.address,
        to: recipient,
        amount: sendAmount,
        isUsd: currency === 'usd',
        originalQuote: approvalData?.ethAmountWei,
        usdAmount: currency === 'usd' ? amount : null,
        message,
        signature,
      };

      const res = await fetch(`${API_BASE}/api/transfer/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });

      const data = await res.json();
      if (data?.error) throw new Error(data.error);

      alert('Transaction successful ✅');
      await fetchBalance(wallet.address);
      await fetchHistory(wallet.address);

      setApprovalData(null);
      setRecipient('');
      setAmount('');
    } catch (err: any) {
      setError(err.message || 'Execution failed');
      alert(err.message);
    }
  };

  const clearWallet = () => {
    localStorage.removeItem('mnemonic');
    setWallet(null);
    setBalance('0');
    setUsdBalance('0');
    setApprovalData(null);
    setTransactions([]);
    setMnemonic('');
    setAmount('');
  };

  return (
    <div className='app-container'>
      <h1 className='app-title'>Web3 Wallet</h1>

      {error && <div className='error'>{error}</div>}

      <section className='wallet-actions'>
        <button className='btn btn-primary' onClick={createWallet}>
          <Wallet size={18} /> Create Wallet
        </button>
        <input
          className='input'
          value={mnemonic}
          onChange={(e) => setMnemonic(e.target.value)}
          placeholder='Enter/import 12-word mnemonic'
        />
        <button className='btn btn-secondary' onClick={importWallet}>
          <Wallet size={18} /> Import
        </button>
        <button className='btn btn-danger' onClick={clearWallet}>
          <XCircle size={18} /> Clear
        </button>
      </section>

      {wallet && (
        <div className='wallet-info'>
          <p>
            <strong>Address:</strong> {wallet.address}
          </p>
          <p className='balance'>
            <strong>Balance in ETH:</strong> {balance} ETH
          </p>
          <p className='balance'>
            <strong>Balance in USD:</strong> {usdBalance} USD
          </p>
        </div>
      )}

      {wallet && wallet.email === null && emailShow && (
        <div className='email-banner'>
          <p>
            You have not configured your email. Set it up to receive transfer
            notifications.
          </p>
          <input
            className='input'
            type='email'
            placeholder='Enter your email'
            value={emailInput}
            onChange={(e) => setEmailInput(e.target.value)}
          />
          <button
            className='btn btn-primary'
            onClick={async () => {
              try {
                const res = await fetch(`${API_BASE}/api/wallet/set-email`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    address: wallet.address,
                    email: emailInput,
                  }),
                });
                const data = await res.json();
                if (data.error) throw new Error(data.error);
                setWallet(Object.assign(wallet, { email: data.email }));
                alert('Email saved successfully ✅');
                setEmailShow(false);
              } catch (err: any) {
                alert(err.message);
              }
            }}
          >
            Save Email
          </button>
        </div>
      )}

      {wallet && (
        <div className='send-section'>
          <h3>
            <Send size={18} /> Send Funds
          </h3>
          <input
            className='input'
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder={`Amount (${currency})`}
          />
          <input
            className='input'
            value={recipient}
            onChange={(e) => setRecipient(e.target.value)}
            placeholder='Recipient address'
          />
          <select
            className='input'
            value={currency}
            onChange={(e) => setCurrency(e.target.value as 'eth' | 'usd')}
          >
            <option value='eth'>ETH</option>
            <option value='usd'>USD</option>
          </select>
          <button className='btn btn-primary' onClick={requestApproval}>
            <Send size={16} /> Request Approval
          </button>
        </div>
      )}

      {approvalData && (
        <div className='approval-section'>
          <p>
            <strong>Approval Message:</strong> {approvalData.message}
          </p>
          <button className='btn btn-success' onClick={signAndExecute}>
            <CheckCircle2 size={16} /> Sign & Execute
          </button>
          <button
            className='btn btn-secondary'
            onClick={() => setApprovalData(null)}
          >
            <XCircle size={16} /> Cancel
          </button>
        </div>
      )}

      <section className='transactions-section'>
        <h3>
          <RefreshCw size={18} /> Transactions
        </h3>
        <button
          className='btn btn-secondary'
          onClick={() => wallet && fetchHistory(wallet.address)}
        >
          Refresh
        </button>
        <ul>
          {transactions.length === 0 && <li>No transactions yet</li>}
          {transactions.map((tx) => (
            <li key={tx.id} className='transaction-item'>
              {tx.from.slice(0, 8)} → {tx.to.slice(0, 8)} :{' '}
              <span className='tx-amount'>{tx.amount} ETH</span> —{' '}
              {new Date(tx.timestamp).toLocaleString()}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
