# Blackboarder Privacy Policy

**Last updated:** November 21, 2026

Blackboarder ("the Extension" and "the Companion Web App") is an open-source student academic companion for Blackboard Learn. We design Blackboarder on a strict local-first, zero-knowledge architecture.

## 1. Data We Process and Where It Lives

- **Local Device Storage (`chrome.storage.local`):** Extracted course deadlines, announcements, gradebook marks, course schedules, syllabus weights, and preferences are stored locally in your browser.
- **Blackboard Session Access:** Blackboarder reads course announcements, enrolled courses, and gradebook entries directly from your university's Blackboard Learn portal using your active browser session (including the `BbRouter` XSRF cookie required by Blackboard's REST API). Your Blackboard username, password, and session cookies are never transmitted to us or any third party.
- **Optional Zero-Knowledge Phone Sync:** If you pair the phone companion app, your tasks, courses, profile, and semester records are encrypted locally on your device using **AES-256-GCM** (derived from your secret Sync Key via HKDF-SHA256) before being stored in Firebase Realtime Database (`v1:iv:ciphertext`). Neither Firebase administrators nor the developer can read your encrypted academic data.
- **Optional AI Extraction:** If you configure an optional AI API key (OpenRouter, IFM, or a custom OpenAI-compatible endpoint), announcement or syllabus text is sent directly to your chosen AI provider solely to extract structured deadline or course weight fields. Without an API key, extraction runs 100% locally on your device.

## 2. What We Never Do

- We **never** collect analytics, telemetry, browsing history, or advertising identifiers.
- We **never** sell, rent, or share student data with third parties.
- We **never** store plaintext academic records in the cloud when Zero-Knowledge Vault Sync is active.

## 3. Data Deletion

- You can clear all local extension data at any time via **Settings > Data** or by uninstalling the extension.
- You can generate a new Sync Key or unpair your devices in **Settings > Sync** to disconnect cloud synchronization immediately.

## 4. Contact

For questions or source-code verification, visit the official repository at https://github.com/yvs1n/blackboarder.
