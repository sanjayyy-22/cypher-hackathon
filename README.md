# Web3 Wallet Application

This is a full-stack Web3 wallet application built using React, Node.js (Express), and Prisma. The app allows users to create/import Ethereum wallets, check balances, send ETH or USD equivalent transfers, and view transaction history.

## Features

* **Create Wallet:** Generate a new Ethereum wallet with a 12-word mnemonic.
* **Import Wallet:** Import an existing wallet using a 12-word mnemonic.
* **View Balance:** Check wallet balance in ETH and USD.
* **Send Funds:** Transfer ETH or USD equivalent to other wallet addresses.
* **Transaction History:** View past transactions with details.
* **Email Notifications:** Configure an email to receive notifications on transactions.
* **Approval Workflow:** Request approval for transfers before signing and executing.
* **Secure Signature Verification:** Transactions require a signed message from the wallet owner.

## Frontend

* Built using **React** and **TypeScript**.
* Uses **ethers.js** for wallet management and signing messages.
* Fetches real-time ETH to USD conversion using **CoinGecko API**.
* State management using React **useState** and **useEffect**.
* Components include wallet actions, balance display, send funds form, approval section, and transactions list.

### Frontend Environment Variables

* `VITE_API_URL` - URL of the backend API (default: `http://localhost:3001`).

### Running Frontend Locally

```bash
# Install dependencies
npm install

# Start development server
npm run dev  # or npm start for CRA
```

## Backend

* Built using **Node.js** and **Express.js**.
* Uses **Prisma ORM** for database interactions.
* Supports Ethereum wallets with balances and transactions.
* Handles ETH and USD transfers with proper quote conversion.
* Sends email notifications using SMTP (e.g., Brevo/Sendinblue).

### Backend Environment Variables

* `DATABASE_URL` - URL of your database (Postgres recommended).
* `BREVO_SMTP_USER` - SMTP username for sending emails.
* `BREVO_SMTP_PASS` - SMTP password.

### Backend API Endpoints

* **Wallet:**

  * `POST /api/wallet/init` - Initialize wallet in DB.
  * `GET /api/wallet/:address` - Fetch wallet balance and email.
  * `POST /api/wallet/set-email` - Set user's email.
* **Transactions:**

  * `GET /api/transactions/:address` - Get transaction history.
  * `POST /api/transfer/approve-eth` - Request approval for ETH transfer.
  * `POST /api/transfer/approve-usd` - Request approval for USD transfer.
  * `POST /api/transfer/execute` - Sign and execute transfer.

### Running Backend Locally

```bash
# Install dependencies
npm install

# Start development server
npm run dev
```

### Notes

* **Database:** Use PostgreSQL or MySQL for production; SQLite is only for development.
* **USD Transfers:** Backend fetches ETH quote for USD transfers and converts to wei.
* **Signature Verification:** All transactions require a valid wallet signature to prevent unauthorized transfers.
* **Email Notifications:** Sent on successful transactions if email is configured.

## Usage

1. Create or import a wallet.
2. View balance in ETH and USD.
3. Set email for notifications (optional).
4. Send funds by entering recipient address and amount, select ETH or USD.
5. Approve the transfer and then sign & execute.
6. Check transaction history to verify the transfer.

## Dependencies

* **React**
* **ethers.js**
* **Express.js**
* **Prisma ORM**
* **CoinGecko API** for ETH to USD conversion
* **Lucide-react** for icons
* **SMTP service** for email notifications
