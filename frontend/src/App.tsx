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
  const [wallet, setWallet] = useState<ethers.Wallet | null>(null);
  const [balance, setBalance] = useState('0');
  const [recipient, setRecipient] = useState('');
  const [amount, setAmount] = useState('');
  const [approvalData, setApprovalData] = useState<any>(null);
  const [transactions, setTransactions] = useState<any[]>([]);
  const [error, setError] = useState('');

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

  const requestApproval = async () => {
    try {
      if (!wallet) throw new Error('Load wallet first');
      if (!recipient) throw new Error('Recipient required');
      if (!amount || Number(amount) <= 0) throw new Error('Enter valid amount');

      const res = await fetch(`${API_BASE}/api/transfer/approve-eth`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: wallet.address, to: recipient, amount }),
      });
      const data = await res.json();
      if (data?.error) throw new Error(data.error);
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
      const signature = await wallet.signMessage(approvalData.message);

      const payload = {
        from: wallet.address,
        to: recipient,
        amount: approvalData.amount,
        signature,
        message: approvalData.message,
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
    setApprovalData(null);
    setTransactions([]);
    setMnemonic('');
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
            <strong>Balance:</strong> {balance} ETH
          </p>
        </div>
      )}

      {wallet && (
        <div className='send-section'>
          <h3>
            <Send size={18} /> Send ETH
          </h3>
          <input
            className='input'
            value={recipient}
            onChange={(e) => setRecipient(e.target.value)}
            placeholder='Recipient address'
          />
          <input
            className='input'
            type='number'
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder='Amount ETH'
          />
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
