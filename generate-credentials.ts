// Mengimpor kelas MeshWallet dari library @meshsdk/core
import { MeshWallet } from "@meshsdk/core";
// Mengimpor modul fs (File System) bawaan Node.js
import fs from "node:fs";

// Mendefinisikan fungsi asynchronous utama
async function main() {
  // Membuat kunci rahasia (secret key) baru untuk dompet Cardano dalam format bech32
  const secret_key = MeshWallet.brew(true) as string;

  // Menulis kunci rahasia yang dihasilkan ke dalam file bernama me.sk
  fs.writeFileSync("me.sk", secret_key);

  // Membuat instance baru dari MeshWallet
  const wallet = new MeshWallet({
    // Mengkonfigurasi dompet untuk menggunakan jaringan testnet Cardano (network ID 1 alias mainnet)
    networkId: 1,
    // Menyediakan kunci rahasia yang baru saja dibuat sebagai kunci root untuk dompet
    key: {
      type: "root",
      bech32: secret_key,
    },
  });

  // Mendapatkan alamat dompet pertama yang belum digunakan dan menulisnya ke dalam file bernama me.addr
  fs.writeFileSync("me.addr", (await wallet.getUnusedAddresses())[0]);
}

// Memanggil fungsi main untuk memulai eksekusi program
main();
