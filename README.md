# Diecast

Apps untuk jejak barang pre-order diecast: barang personal, barang kastemer yang dah OTW, dan barang yang dah beli tapi belum ship. Ia laman web biasa (HTML, CSS, JavaScript) yang boleh dipasang pada telefon macam apps, dan boleh dibuka tanpa internet selepas kali pertama.

Developed by FaridAssamani.

## Flow kerja

Yang dijejak ialah setiap **item**, sebab satu order boleh pecah kepada beberapa parcel.

| Tab | Peringkat | Apa yang kau tekan |
|---|---|---|
| **Tempahan** | Tempahan kastemer, kemudian dibeli di CM | **Tempahan baru** (butang bawah): item, kastemer, harga jual, bayaran awal. Bila dah beli di CM: **+ Order CM**, isi no. order, tarikh (kadar diambil sendiri), shipping, kemudian **tag** item tempahan dan isi harga beli seunit (item sama nama diisi sendiri). **Senarai order** tunjuk semua order CHP. |
| **Transit** | Ke Oregon → di Oregon → ke Hong Kong → di Hong Kong → kotak → dipost ke MY | **Declare** (tanda item dalam satu parcel, tampal tracking US) → **Sampai Oregon** → **Ke HK** → **Sampai HK** → **Consolidate** (kos posting BNS) → **Isi Skynet** → **Sampai MY**. Boleh langkau terus ke **Sampai HK** dari Oregon. |
| **Tiba** | Dah sampai, sorting ikut kastemer | **WhatsApp baki**, kemudian **Serah**: Post J&T (tracking + kos J&T) atau Hantar sendiri. Barang `AKU`: **Dah ambil**. |
| **Penghantaran** | Tunggu kastemer sahkan | **Mesej** (tracking + baki), kemudian **Dah terima**. Item masuk Arkib. |
| **Peribadi** | Barang aku beli dari orang lain (contoh Enal) | Tambah item, rekod bayaran aku, **Dah terima barang**. |

**Parcel:** item yang declare dengan tracking yang sama bergerak bersama. Butang Tiba di gudang / Hantar ke hub / Tiba di hub buka senarai parcel untuk dipilih.

**Penghantaran:** satu hantaran J&T boleh mengandungi item beberapa pelanggan yang guna alamat sama (bahagian *Pelanggan lain, alamat sama?* dalam borang Hantar).

**Pautan tracking:** dalam garis masa item ada pautan *Jejak FedEx / USPS / Skynet / J&T*. FedEx dan USPS terus buka status; Skynet dan J&T buka laman tracking dan nombor disalin untuk ditampal.

**Imbas barcode J&T:** butang *Imbas barcode* di bawah medan Tracking J&T (borang Hantar). Guna kamera, atau *Dari galeri* untuk baca barcode dari screenshot label.

**Gambar item:** dalam Tempahan baru / Order CM setiap baris ada *+ Gambar* (galeri/kamera) atau *Pautan*. Untuk item sedia ada: buka item > *+ Gambar item*. Pilih / ambil gambar (dikecilkan sendiri) atau tampal pautan gambar. Boleh guna untuk semua item bernama sama.

**Leret kad:** ke kanan = rekod bayaran penuh (apps tanya dulu); ke kiri = barang dah diserah, masuk Arkib (ada **Buat asal**).

Ikon di atas: **Senarai order CM**, **Arkib**, dan **Pelanggan** (baki setiap pelanggan; dari situ boleh **Tukar nama / gabung** dua nama yang sebenarnya orang sama).

## Bahasa

Tiga titik > **Bahasa**: Bahasa Melayu atau English. Apps dimuat semula bila bahasa ditukar. Data sendiri (nama item, pelanggan, catatan) dan mesej WhatsApp kepada pelanggan kekal seperti ditaip. Terjemahan English ada dalam `en.js`.

## Kos dan untung

Kos sebenar setiap item:

1. **Harga beli** seunit × qty × kadar tukaran order
2. **Shipping + tax order**, dibahagi ikut harga beli setiap item
3. **Kos posting BNS** kotak, dibahagi ikut (1 + 2)
4. **Kos J&T** hantaran, dibahagi ikut (1 + 2)

Untung = harga jual − kos sebenar. Laporan dalam tiga titik > **Untung rugi**: untung dikira pada **tarikh item selesai** (masuk Arkib), dipecah ikut tahun (pilih tahun atau *Semua*), ikut bulan, dan perbandingan tahunan. Item yang belum selesai ditunjuk berasingan sebagai anggaran.

**Arkib** dipapar ikut tahun (tahun semasa dulu; ketik tahun lain atau *Semua*). Setiap bulan boleh dibuka / dilipat dan menunjukkan bilangan item, jualan dan untung. Carian merangkumi semua tahun. Tiada item dibuang.

Kadar tukaran diambil sendiri ikut **tarikh beli** order (kadar pasaran USD→MYR dari Frankfurter/ECB; hujung minggu guna hari bekerja sebelumnya). Kalau nak lebih tepat:

- isi **jumlah dicaj kad (RM)** dan app kira kadar sebenar, atau
- tetapkan **Caj tukaran kad (%)** dalam Tetapan supaya kadar pasaran ditambah sedikit, atau
- taip kadar sendiri.

Order lama: buka order dan tekan **Guna kadar pasaran (tarikh)**.

## Data dari versi lama

Bila app dibuka, data lama ditukar sendiri tanpa dibuang:

- Belum Ship lama → **Belum Ship** (kumpulan *Tanpa order*)
- OTW lama → **OTW · dari Excel**. Masukkan ke kotak bila tahu.
- Barang dari Enal → **Personal**
- Barang CM untuk aku → **Belum Ship** sebagai `AKU`

## Warna status

- **Hijau**: dah bayar penuh
- **Kuning**: depo
- **Oren**: belum bayar
- **Biru (Aku)**: barang sendiri

## Fail dalam repo ini

| Fail | Guna |
|---|---|
| `index.html` | Muka apps |
| `style.css` | Warna (terang dan gelap) dan susun atur |
| `app.js` | Semua logik apps |
| `en.js` | Terjemahan English |
| `config.js` | Client ID Google (projek akaun peribadi) untuk log masuk dan selaras Google Drive |
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

Data disimpan dalam browser peranti itu, dan dalam Google Drive kalau disambung. Tak ada data disimpan di GitHub. Tanpa Drive, sekali-sekala tekan **Simpan salinan** (gambar disertakan).

Gambar disimpan berasingan daripada data utama: dalam IndexedDB peranti, dan satu fail bagi setiap gambar dalam folder apps Google Drive. Item hanya simpan rujukan, jadi data utama kekal kecil. Gambar yang sama (contoh: item bernama sama) disimpan sekali sahaja. Saiz storan ditunjuk dalam tiga titik > **Data**.
