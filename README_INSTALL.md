# 🔊 Normalizer — Installation Guide (YouTube PoC)

Lightweight real-time audio normalization for YouTube.

This extension demonstrates a WebAudio-based normalization pipeline designed for minimal friction and instant activation.

---

## 📦 Installation (Chrome / Edge)

Because this is a Proof of Concept, the extension must be loaded manually.

### Step 1 — Download the extension

- Go to the GitHub repository
- Download the latest ZIP from **Releases**
- Extract the ZIP to a folder on your computer

The folder must directly contain:


manifest.json
content.js
audioEngine.js
loudness-processor.js
ui.js


⚠️ Do **not** keep the files inside an extra nested folder.

---

### Step 2 — Open Extensions page

**Chrome**

- Open Chrome
- Navigate to:


chrome://extensions/


**Edge**

- Open Edge
- Navigate to:


edge://extensions/


---

### Step 3 — Enable Developer Mode

Top-right corner:

✅ Toggle **Developer mode** ON

---

### Step 4 — Load the extension

Click:


Load unpacked


Then select the folder containing the extension files.

✅ The Normalizer extension should now appear in your extensions list.

---

## ▶️ Usage

1. Open any YouTube video  
2. The Normalizer UI will appear in the player  
3. Toggle **ON/OFF** to activate real-time normalization  

The processing runs locally in your browser using WebAudio.

---

## 🧠 Technical Notes

- Manifest V3 compliant  
- AudioWorklet-based processing  
- No external servers  
- No data collection  
- No telemetry  
- Offline-capable  

This project is intentionally minimal and designed as a technical Proof of Concept.

---

## ⚠️ Disclaimer

This extension is provided for demonstration and research purposes only.

YouTube is a trademark of Google LLC.  
This project is not affiliated with or endorsed by Google or YouTube.

---

## 👤 Author

**Jean-François Aldebert**  
Product Engineer / Venture Builder

---

## 📄 License

Private — all rights reserved.  
Contact the author for collaboration or licensing inquiries.