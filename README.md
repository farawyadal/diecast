# Diecast

Apps untuk jejak barang pre-order diecast: barang personal, barang kastemer yang dah OTW, dan barang yang dah beli tapi belum ship. Ia laman web biasa (HTML, CSS, JavaScript) yang boleh dipasang pada telefon macam apps, dan boleh dibuka tanpa internet selepas kali pertama.

Developed by FaridAssamani.

## Kategori

- **Personal**: barang aku order untuk diri sendiri (dari Mattel Creations, atau dari orang lain macam Enal).
- **OTW**: barang kastemer yang dah ship, dalam perjalanan ke Malaysia.
- **Belum Ship**: barang kastemer yang dah beli tapi belum ship.
- **Order**: order Mattel dan kotak Buyandship, ikut peringkat.
- **Arkib**: barang yang dah diserah pada kastemer (atau dah sampai untuk personal).

## Order dan Kotak (tab Order)

Untuk jejak order Mattel Creations sampai ke Malaysia melalui Buyandship.

1. **Order baru**: isi no. order (CHP…), akaun (fa.rawyadal / assamani83) dan tanda item mana dalam order itu.
2. **Dah ship dari US**: satu tekan, tampal tracking kalau ada. Item kastemer dalam order itu pindah sendiri dari Belum Ship ke OTW.
3. **Declared** dan **Sampai hub**: tanda pilihan, tak wajib.
4. **Masuk kotak**: bila consolidate di Buyandship, masukkan order ke satu kotak (atau buat kotak dari tab Order > **+ Kotak baru**).
5. Dari skrin kotak: **Dah post ke MY** (tracking MY pilihan), kemudian **Dah sampai MY**. Semua order dan item dalam kotak ikut sekali.

- Kad item tunjuk peringkat order dan bilangan hari sejak beli.
- Dari skrin item, **Pair dengan order** untuk sambung item lama dengan order.
- Order hilang dari senarai Aktif bila dah sampai MY dan semua itemnya diarkibkan (ada di tapisan **Selesai**).
- Kos shipping kotak hanya direkod, tak dicaj pada kastemer.
- Tarikh boleh dibetulkan melalui **Edit order** atau **Edit / urus order** dalam kotak.

## Warna status

Dikira sendiri daripada harga dan jumlah bayaran:

- **Hijau**: dah bayar penuh
- **Kuning**: depo (dah bayar sebahagian)
- **Oren**: belum bayar
- **Kelabu**: harga belum diisi

## Cara guna

- Tekan item untuk buka butiran. Dari situ:
  - **+ Bayaran**: rekod bayaran (jumlah, tarikh, nota). Guna nombor negatif untuk refund.
  - **Bayar penuh**: rekod baki penuh sekali tekan.
  - **WhatsApp minta baki**: buka WhatsApp dengan mesej baki siap ditulis.
  - **Dah ship · pindah ke OTW**: untuk barang Belum Ship.
  - **Arkibkan**: bila barang dah diserah. Item dalam Arkib boleh dipulihkan.
  - **Edit** dan **Padam** (apps tanya dulu, dan ada **Buat asal**).
  - Sejarah bayaran, dan butang X untuk buang bayaran yang tersilap.
- Butang **Tambah item** di bawah kanan.
- Ikon orang di atas: senarai kastemer dengan jumlah baki setiap orang, dan mesej WhatsApp minta baki untuk semua item dia sekali gus.
- Kotak cari dan butang status untuk tapis senarai.

## Tetapan (tiga titik)

- **Paparan**: Ikut sistem, Terang atau Gelap.
- **Maklumat bayaran**: ayat akaun bank yang dimasukkan di hujung mesej WhatsApp. Disimpan dalam peranti (dan Drive), bukan di GitHub.
- **Selaras Google Drive**: guna data yang sama di phone dan PC.
- **Simpan salinan** dan **Import fail**.

## Fail dalam repo ini

| Fail | Guna |
|---|---|
| `index.html` | Muka apps |
| `style.css` | Warna (terang dan gelap) dan susun atur |
| `app.js` | Semua logik apps |
| `config.js` | Client ID Google untuk selaras Google Drive (sama dengan MyBajet) |
| `manifest.webmanifest`, `sw.js` | Supaya boleh dipasang pada telefon dan dibuka tanpa internet |
| `icon-192.png`, `icon-512.png`, `apple-touch-icon.png` | Ikon apps |
| `og-image.png` | Gambar pratonton bila pautan dikongsi di WhatsApp |

## Letak di GitHub

1. Di GitHub, buat repository baru bawah **farawyadal** bernama `diecast`, pilih **Public**.
2. **Add file > Upload files**, upload semua fail di atas, kemudian **Commit changes**.
3. **Settings > Pages**: Branch `main`, folder `/ (root)`, **Save**.
4. Alamat apps: `https://farawyadal.github.io/diecast/`

## Masukkan senarai awal

Kali pertama buka, tekan **Import senarai** dan pilih `senarai-awal.json`. Fail itu **jangan** di-upload ke GitHub, sebab repo ini public dan fail itu ada nama dan nombor telefon kastemer.

## Data disimpan di mana

Data disimpan dalam browser peranti itu, dan dalam Google Drive kalau disambung. Tak ada data disimpan di GitHub. Tanpa Drive, sekali-sekala tekan **Simpan salinan**.
