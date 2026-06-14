// NOVA AI - Web Crypto Encryption Module
// AES-GCM 256-bit with PBKDF2 key derivation

const CryptoUtils = {
  _key: null,
  _initialized: false,

  async init(password = 'nova-ai-default-key-2024') {
    const encoder = new TextEncoder();
    const salt = encoder.encode('nova-ai-salt-v1');

    const keyMaterial = await crypto.subtle.importKey(
      'raw',
      encoder.encode(password),
      'PBKDF2',
      false,
      ['deriveKey']
    );

    this._key = await crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt,
        iterations: 600000,
        hash: 'SHA-256',
      },
      keyMaterial,
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt']
    );

    this._initialized = true;
    return this._key;
  },

  async encrypt(plaintext) {
    if (!this._key) await this.init();

    const encoder = new TextEncoder();
    const data = encoder.encode(
      typeof plaintext === 'string' ? plaintext : JSON.stringify(plaintext)
    );

    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encrypted = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      this._key,
      data
    );

    const combined = new Uint8Array(iv.length + encrypted.byteLength);
    combined.set(iv, 0);
    combined.set(new Uint8Array(encrypted), iv.length);

    return btoa(String.fromCharCode(...combined));
  },

  async decrypt(ciphertextB64) {
    if (!this._key) await this.init();

    const combined = Uint8Array.from(atob(ciphertextB64), c => c.charCodeAt(0));
    const iv = combined.slice(0, 12);
    const data = combined.slice(12);

    const decrypted = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv },
      this._key,
      data
    );

    return new TextDecoder().decode(decrypted);
  },

  async hash(data) {
    const encoder = new TextEncoder();
    const hash = await crypto.subtle.digest('SHA-256', encoder.encode(data));
    return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
  },

  generateId() {
    return crypto.randomUUID();
  }
};
