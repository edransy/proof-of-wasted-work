# ProofOfWastedWork & NearMissToken

Welcome to **ProofOfWastedWork** and **NearMissToken** – an innovative protocol that monetizes the "wasted" computational work from Bitcoin mining. This project leverages the idea that Bitcoin miners produce countless "near misses" (i.e., proofs-of-work that nearly satisfy Bitcoin's difficulty requirements) which are normally discarded. Our system rewards those wasted efforts with tokens on the Solana blockchain.

## Overview

**ProofOfWastedWork** is our novel approach to capture and reward the "wasted" proofs-of-work that nearly qualify as valid Bitcoin blocks. Instead of discarding these near misses, our system verifies these proofs via a Solana smart contract and mints tokens known as **NearMissToken**.

This cross-chain innovation:
- Provides supplemental revenue streams for Bitcoin miners.
- Encourages decentralized and inclusive participation.
- Bridges data from Bitcoin to Solana via robust oracles (Switchboard).

---

## Mechanism & Purpose

### ProofOfWastedWork

- **Concept:** Bitcoin miners expend enormous computational power to solve proof-of-work puzzles. Most attempts fail to meet the strict criteria required by Bitcoin, yet many come close—these are "near misses."
- **Purpose:** By capturing and providing cryptographic proof of these near misses, ProofOfWastedWork turns typically wasted computational work into valuable data.
- **Implementation:** Miners use a modified mining software that, upon detecting a hash with N-1 trailing zero bytes (instead of N), submits a proof (containing the Bitcoin header components and nonce data) to the Solana network. This submitted proof is then verified on-chain using reliable Bitcoin block data from an oracle.

### NearMissToken

- **Concept:** NearMissToken is an ERC-like token on Solana that is minted as a reward for submitting valid near-miss proofs. 
- **Purpose:** The token creates a new incentivization mechanism separate from Bitcoin's intrinsic block rewards—monetizing otherwise discarded work.
- **Integration:** It employs robust anti-spam measures, such as nonce tracking to prevent double minting and optional economic deterrents like submission fees or deposits. Token minting is controlled and adjusted according to near-miss frequency and network conditions.

---

## Architecture

### Modified Mining Software

- **Function:** The miner's software is modified to continuously monitor Bitcoin block header hashes. When a "near miss" (a hash that almost meets the Bitcoin difficulty) is detected, the miner extracts the relevant header fields (version, previous block hash, merkle root, timestamp, bits, nonce, extra_nonce) and submits them to the smart contract.
- **Integration:** This submission can be automated, allowing miners to easily benefit from additional rewards without significantly disrupting their primary mining process.

### Solana Smart Contract

- **Language/Framework:** Written in Rust using the Anchor framework.
- **Responsibilities:**
  - **Verification:** Reconstructs the Bitcoin block header from the submitted data, computes a double SHA‑256 hash, and verifies that the hash has exactly (N-1) trailing zero bytes.
  - **Nonce Management:** Stores submitted nonces to prevent duplicate submissions within the same Bitcoin block, and clears them when a new block is detected via the Bitcoin height oracle.
  - **Token Minting:** Upon successful verification, mints a pre-defined amount of NearMissToken to the submitter's associated token account.
  - **Anti-Spam Measures:** Incorporates mechanisms like deposit requirements, rate limiting, and nonce tracking to deter spam and invalid submissions.

### Oracle Integration with Switchboard

- **Switchboard Oracles:** Used for retrieving reliable Bitcoin metrics (block height, difficulty, and block timestamp). These data feeds ensure that the on-chain proof verification relies on authentic and timely Bitcoin network data.
- **Setup:** Feeds are configured using the Switchboard CLI and are updated by a decentralized network of nodes. The smart contract directly queries these feeds to confirm the validity of near-miss submissions.

### State Management & Anti-Spam Mechanisms

- **Nonce Storage:** Each valid near-miss submission includes a unique nonce that is stored in a persistent account to prevent re-use within the same Bitcoin block.
- **Automatic State Reset:** When a new block is detected (via the updated block height feed), the stored nonces are cleared, allowing new submissions.
- **Deposits & Fees:** Optional economic disincentives (e.g., a security deposit or submission fee) can be required, making it costly for malicious actors to spam the contract with invalid data.

---

## Tokenomics & Market Potential

- **Emission Rate:** NearMiss proofs are expected to be submitted roughly once per minute, leading to a predictable and transparent token emission schedule.
- **Supply Controls:** With mechanisms for dynamic difficulty adjustment and optional burn/slashing features, inflation can be managed effectively.
- **Economic Value:** The additional revenue for miners from wasted work, coupled with the token's integration into Solana's vibrant DeFi ecosystem, forms the basis for its market attractiveness.
- **Cross-Chain Appeal:** By bridging Bitcoin mining data with Solana's fast and cost-effective smart contract capabilities, the project opens up new economic models and investment opportunities.

---

## Future Work & Improvements

- **Dynamic Tokenomics:** Further work on dynamic supply control, staking mechanisms, and burn/slash systems.
- **Enhanced Oracle Integration:** Expanding oracle feeds with multiple data sources for redundancy and improved accuracy.
- **Commit-Reveal or Batch Processing:** To further mitigate spamming and manage multiple near-miss submissions in high-frequency environments.
- **Cross-Chain Governance:** Potential integration of governance features that allow token holders (miners) to influence protocol parameters.

---

## Conclusion

**ProofOfWastedWork** and **NearMissToken** represent a cutting-edge convergence of Bitcoin mining and Solana smart contract technology. By capturing and monetizing near-miss proofs-of-work, this system not only creates a new economic incentive for miners but also introduces a novel DeFi asset with predictable and transparent issuance.

This project bridges two prominent blockchain ecosystems—with robust oracle support ensuring accurate, real-time Bitcoin data—and paves the way for innovative cross-chain applications. We invite developers, miners, and DeFi enthusiasts to explore, contribute, and help evolve this exciting protocol.

---
