/*
  Diecast: jejak barang pre-order diecast, dari order sampai ke tangan kastemer.
  Data disimpan dalam localStorage peranti ini, dan boleh diselaras dengan Google Drive.

  Unit yang dijejak ialah ITEM, sebab satu order boleh pecah kepada beberapa parcel.

  Jenis item (kat):
    jual = barang kastemer
    aku  = barang aku sendiri yang ikut flow sama (order CM -> BNS -> MY)
    luar = barang aku beli dari orang lain (Personal), asing dari flow order

  Peringkat item jual/aku (dikira, bukan disimpan):
    beli   -> dalam order, belum ship ke hub              (tab Belum Ship)
    ship   -> dah ship ke hub BNS Oregon (tracking US)    (tab OTW)
    hub    -> sampai hub Oregon                           (tab OTW)
    keHK   -> BNS hantar dari Oregon ke Hong Kong         (tab OTW)
    hk     -> sampai Hong Kong, boleh consolidate         (tab OTW)
    hub    -> dah sampai hub                              (tab OTW)
    kotak  -> dah consolidate, tunggu tracking Skynet     (tab OTW)
    post   -> kotak dipost ke MY (Skynet)                 (tab OTW)
    sampai -> kotak sampai MY, perlu sorting dan serah    (tab Sampai)
    hantar -> dipos J&T / hantar sendiri, tunggu sahkan   (tab Hantar)
    selesai-> kastemer dah terima                         (Arkib)

  Kos sebenar item = harga beli (mata wang order x kadar)
                   + bahagian shipping order (pro-rata ikut harga beli)
                   + bahagian kos posting BNS kotak (pro-rata ikut kos di atas)
                   + bahagian kos J&T hantaran (pro-rata ikut kos di atas)

  Status bayaran dikira daripada harga jual dan jumlah bayaran:
    dah bayar (hijau) | depo (kuning) | belum bayar (oren) | tiada harga (kelabu)
*/
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const KUNCI = 'diecast-data';
  const KUNCI_TETAPAN = 'diecast-tetapan';

  const TAB = {
    beli: 'Tempahan', otw: 'Transit', sampai: 'Tiba', hantar: 'Penghantaran', luar: 'Peribadi', arkib: 'Arkib',
  };
  const PERINGKAT = {
    beli: 'Dalam tempahan', ship: 'Dalam perjalanan ke gudang', hub: 'Di gudang', keHK: 'Dalam perjalanan ke hub',
    hk: 'Di hub', kotak: 'Disatukan (consolidate)', post: 'Dalam perjalanan ke Malaysia',
    sampai: 'Tiba di Malaysia', hantar: 'Dalam penghantaran', selesai: 'Selesai',
  };
  const TAB_PERINGKAT = { beli: 'beli', ship: 'otw', hub: 'otw', keHK: 'otw', hk: 'otw', kotak: 'otw', post: 'otw', sampai: 'sampai', hantar: 'hantar', selesai: 'arkib' };
  const STATUS = { lunas: 'Lunas', depo: 'Deposit', belum: 'Belum bayar', tiada: 'Tiada harga' };
  // Bahasa paparan: dibaca sekali semasa buka. Tukar bahasa = muat semula halaman.
  const BAHASA = (() => {
    try { return JSON.parse(localStorage.getItem('diecast-tetapan') || '{}').bahasa === 'en' ? 'en' : 'ms'; } catch (e) { return 'ms'; }
  })();
  const BULAN = BAHASA === 'en'
    ? ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
    : ['Jan', 'Feb', 'Mac', 'Apr', 'Mei', 'Jun', 'Jul', 'Ogo', 'Sep', 'Okt', 'Nov', 'Dis'];
  const AKU = 'AKU';

  let data = { v: 2, diubah: 0, items: [], orders: [], kotak: [], hantar: [], sale: [], bank: '', kadar: null };
  let tetapan = { tema: 'sistem', tab: 'beli', status: 'semua', akaun: 'fa.rawyadal', bahasa: BAHASA };
  let cari = '';

  /* ---------- Alat kecil ---------- */

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const bulat = (n) => Math.round((Number(n) || 0) * 100) / 100;
  const idBaru = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const nomborAtauNull = (v) => (v === null || v === undefined || v === '' || isNaN(Number(v)) ? null : bulat(v));
  const masaAtauNull = (n) => Number(n) || null;
  const HARI = 86400000;
  const bilHari = (dari, hingga) => Math.max(0, Math.floor(((hingga || Date.now()) - dari) / HARI));

  function wang(n, simbol) {
    n = bulat(n);
    const neg = n < 0;
    const a = Math.abs(n);
    const s = Number.isInteger(a)
      ? a.toLocaleString('en-US')
      : a.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return (neg ? '-' : '') + simbol + s;
  }
  const rm = (n) => wang(n, 'RM');
  const mataSimbol = (m) => (m === 'USD' ? 'US$' : m === 'RM' ? 'RM' : (m || '') + ' ');

  function tarikh(ms) {
    if (!ms) return '-';
    const d = new Date(ms);
    return d.getDate() + ' ' + BULAN[d.getMonth()] + ' ' + d.getFullYear();
  }
  function tarikhInput(ms) {
    const d = ms ? new Date(ms) : new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function dariInput(s) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || '');
    if (!m) return Date.now();
    return new Date(+m[1], +m[2] - 1, +m[3], 12).getTime();
  }
  const tarikhAtauNull = (v) => (v ? dariInput(v) : null);

  // Zon waktu untuk sale. Masa sale CM biasanya diumumkan dalam waktu US.
  const ZON = {
    MY: { tz: 'Asia/Kuala_Lumpur', label: 'Waktu Malaysia', pendek: 'MY' },
    PT: { tz: 'America/Los_Angeles', label: 'Waktu Pasifik US (PT)', pendek: 'PT' },
    ET: { tz: 'America/New_York', label: 'Waktu Timur US (ET)', pendek: 'ET' },
  };
  const NAMA_HARI = BAHASA === 'en' ? ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] : ['Ahd', 'Isn', 'Sel', 'Rab', 'Kha', 'Jum', 'Sab'];
  const dua = (n) => String(n).padStart(2, '0');
  function bahagianZon(ms, tz) {
    const p = {};
    new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
      .formatToParts(new Date(ms)).forEach((x) => { p[x.type] = x.value; });
    return { y: +p.year, mo: +p.month, d: +p.day, h: +p.hour % 24, mi: +p.minute };
  }
  // Masa dinding dalam zon tz -> UTC ms (ambil kira waktu musim panas US).
  function keUtc(y, mo, d, h, mi, tz) {
    const sasaran = Date.UTC(y, mo - 1, d, h, mi);
    let t = sasaran;
    for (let i = 0; i < 3; i++) {
      const b = bahagianZon(t, tz);
      const beza = sasaran - Date.UTC(b.y, b.mo - 1, b.d, b.h, b.mi);
      if (!beza) break;
      t += beza;
    }
    return t;
  }
  function masaZon(ms, zon, pendek) {
    const b = bahagianZon(ms, ZON[zon].tz);
    const hari = NAMA_HARI[new Date(Date.UTC(b.y, b.mo - 1, b.d)).getUTCDay()];
    return pendek ? hari + ' ' + dua(b.h) + ':' + dua(b.mi) : hari + ' ' + b.d + ' ' + BULAN[b.mo - 1] + ' ' + b.y + ', ' + dua(b.h) + ':' + dua(b.mi);
  }
  function bakiMasa(ms) {
    const m = Math.ceil((ms - Date.now()) / 60000);
    if (m <= 0) return '';
    const h = Math.floor(m / 1440), j = Math.floor((m % 1440) / 60), mi = m % 60;
    if (h) return h + ' hari' + (j ? ' ' + j + ' jam' : '');
    if (j) return j + ' jam' + (mi ? ' ' + mi + ' minit' : '');
    return mi + ' minit';
  }

  const dibayar = (it) => bulat((it.bayaran || []).reduce((j, b) => j + (Number(b.amaun) || 0), 0));
  const baki = (it) => bulat((Number(it.harga) || 0) - dibayar(it));
  const bakiPositif = (senarai) => bulat(senarai.reduce((j, it) => j + Math.max(0, baki(it)), 0));

  function status(it) {
    const h = Number(it.harga) || 0;
    const b = dibayar(it);
    if (h <= 0) return b > 0 ? 'lunas' : 'tiada';
    if (b >= h - 0.004) return 'lunas';
    if (b > 0) return 'depo';
    return 'belum';
  }

  const kunciOrang = (s) => String(s || '').trim().toUpperCase().replace(/\s+/g, ' ');

  function noWa(tel) {
    let d = String(tel || '').replace(/\D/g, '');
    if (!d) return '';
    if (d.startsWith('0')) d = '6' + d;
    return d;
  }

  const labelItem = (it) => (it.jenis ? it.jenis + ' ' : '') + it.nama + (it.qty > 1 ? ' ×' + it.qty : '');

  /* ---------- Bentuk data ---------- */

  function bersihBayaran(senarai) {
    return Array.isArray(senarai)
      ? senarai.filter((b) => b && Number(b.amaun)).map((b) => ({
        id: String(b.id || idBaru()), amaun: bulat(b.amaun), t: Number(b.t) || Date.now(), nota: String(b.nota || '').slice(0, 80),
      }))
      : [];
  }

  function bersihItem(x) {
    if (!x || typeof x !== 'object' || !x.nama) return null;
    let kat = x.kat;
    let orang = String(x.orang || '').trim().slice(0, 60);
    if (!['jual', 'aku', 'luar'].includes(kat)) kat = 'jual';
    if (kat === 'aku') orang = AKU;
    return {
      id: String(x.id || idBaru()),
      kat,
      jenis: String(x.jenis || '').trim().toUpperCase().slice(0, 20),
      nama: String(x.nama).trim().slice(0, 80),
      qty: Math.max(1, parseInt(x.qty, 10) || 1),
      orang,
      tel: String(x.tel || '').trim().slice(0, 30),
      harga: bulat(x.harga),                     // harga jual (jual) / harga beli (luar), jumlah untuk qty
      bayaran: bersihBayaran(x.bayaran),
      catatan: String(x.catatan || '').slice(0, 300),
      dibuat: Number(x.dibuat) || Date.now(),
      urutan: Number(x.urutan) || 0,
      // Kos
      orderId: x.orderId ? String(x.orderId) : null,
      beli: nomborAtauNull(x.beli),               // harga beli seunit, dalam mata wang order
      modal: nomborAtauNull(x.modal),             // kos RM manual (bila tiada order / harga beli)
      // Perjalanan
      tShip: masaAtauNull(x.tShip),
      trackUS: String(x.trackUS || '').trim().slice(0, 60),
      tDeclare: masaAtauNull(x.tDeclare),
      tHub: masaAtauNull(x.tHub),                 // sampai hub Oregon
      tKeHK: masaAtauNull(x.tKeHK),               // dihantar Oregon -> Hong Kong
      tHK: masaAtauNull(x.tHK),                   // sampai Hong Kong
      kotakId: x.kotakId ? String(x.kotakId) : null,
      hantarId: x.hantarId ? String(x.hantarId) : null,
      arkib: masaAtauNull(x.arkib),
      lama: !!x.lama,
      anggaran: !!x.anggaran,
      gambar: String(x.gambar || '').slice(0, 300000), // pautan gambar atau gambar kecil (data URL)                     // kos RM ialah anggaran (item lama tanpa rekod order)                             // dari Excel: OTW tanpa butiran perjalanan
    };
  }

  function bersihOrder(x) {
    if (!x || typeof x !== 'object') return null;
    const mata = ['USD', 'RM'].includes(x.mata) ? x.mata : 'USD';
    return {
      id: String(x.id || idBaru()),
      kedai: String(x.kedai || 'Mattel Creations').trim().slice(0, 40),
      no: String(x.no || '').trim().slice(0, 40),
      akaun: String(x.akaun || '').trim().slice(0, 40),
      tBeli: Number(x.tBeli) || Date.now(),
      mata,
      kadar: mata === 'RM' ? 1 : (nomborAtauNull(x.kadar) === null ? null : Math.round(Number(x.kadar) * 10000) / 10000),
      ship: nomborAtauNull(x.ship) || 0,         // shipping + tax order, dalam mata wang order
      kadarNota: String(x.kadarNota || '').slice(0, 80), // dari mana kadar datang
      catatan: String(x.catatan || '').slice(0, 300),
      dibuat: Number(x.dibuat) || Date.now(),
    };
  }

  function bersihKotak(x) {
    if (!x || typeof x !== 'object') return null;
    return {
      id: String(x.id || idBaru()),
      no: String(x.no || '').trim().slice(0, 40),
      kos: nomborAtauNull(x.kos),                 // kos posting BNS (RM)
      tBuat: Number(x.tBuat) || Number(x.dibuat) || Date.now(),
      trackMY: String(x.trackMY || '').trim().slice(0, 60),
      tPost: masaAtauNull(x.tPost),
      tSampai: masaAtauNull(x.tSampai),
      catatan: String(x.catatan || '').slice(0, 300),
      dibuat: Number(x.dibuat) || Date.now(),
    };
  }

  function bersihHantar(x) {
    if (!x || typeof x !== 'object') return null;
    return {
      id: String(x.id || idBaru()),
      orang: String(x.orang || '').trim().slice(0, 60),
      cara: x.cara === 'sendiri' ? 'sendiri' : 'pos',
      track: String(x.track || '').trim().slice(0, 60),
      kos: nomborAtauNull(x.kos),                 // kos J&T (RM), aku tanggung
      t: Number(x.t) || Date.now(),
      tTerima: masaAtauNull(x.tTerima),
      dibuat: Number(x.dibuat) || Date.now(),
    };
  }

  // Tukar data versi lama (kategori personal/otw/tunggu, order bertahap) kepada bentuk baru.
  // Tiada data dibuang.
  function naikTaraf(j) {
    const ordersLama = Array.isArray(j.orders) ? j.orders : [];
    const orderLama = (id) => ordersLama.find((o) => o && o.id === id);
    const kini = Date.now();
    (Array.isArray(j.items) ? j.items : []).forEach((it) => {
      if (!it || typeof it !== 'object') return;
      if (it.kat === 'personal') {
        const k = kunciOrang(it.orang);
        if (k.includes('MATTEL') || k === 'FARID' || k === AKU) {
          it.kat = 'aku';
          if (!it.catatan && k !== AKU) it.catatan = 'Asal: ' + it.orang;
        } else {
          it.kat = 'luar';
        }
      } else if (it.kat === 'otw' || it.kat === 'tunggu') {
        if (it.kat === 'otw' && !it.tShip) { it.tShip = Number(it.dibuat) || kini; it.tDeclare = it.tShip; it.lama = true; }
        it.kat = 'jual';
      }
      // Peringkat yang dulu disimpan pada order: salin ke item.
      const o = it.orderId ? orderLama(it.orderId) : null;
      if (o) {
        if (o.tShip && !it.tShip) it.tShip = o.tShip;
        if (o.trackUS && !it.trackUS) it.trackUS = o.trackUS;
        if (o.tDeclare && !it.tDeclare) it.tDeclare = o.tDeclare;
        if (o.tHub && !it.tHub) it.tHub = o.tHub;
        if (o.kotakId && !it.kotakId) it.kotakId = o.kotakId;
      }
    });
    return j;
  }

  // Sale akan datang: t = masa mula (UTC ms); zon = zon waktu yang dimasukkan pengguna.
  function bersihSale(x) {
    if (!x || !String(x.nama || '').trim() || !Number(x.t)) return null;
    return {
      id: String(x.id || idBaru()),
      jenis: String(x.jenis || '').slice(0, 20),
      nama: String(x.nama).trim().slice(0, 120),
      t: Number(x.t),
      zon: ZON[x.zon] ? x.zon : 'MY',
      pautan: /^https?:\/\//.test(x.pautan || '') ? String(x.pautan).slice(0, 500) : '',
      catatan: String(x.catatan || '').slice(0, 500),
      eventId: String(x.eventId || '').slice(0, 200),
      kunci: kunciOrang(x.kunci || ((x.jenis || '') + ' ' + x.nama)), // padankan dengan item tempahan bernama sama
      dibuat: Number(x.dibuat) || Date.now(),
    };
  }

  function bersihData(j) {
    naikTaraf(j);
    const d = {
      v: 2,
      diubah: Number(j.diubah) || Date.now(),
      items: (Array.isArray(j.items) ? j.items : []).map(bersihItem).filter(Boolean),
      orders: (Array.isArray(j.orders) ? j.orders : []).map(bersihOrder).filter(Boolean),
      kotak: (Array.isArray(j.kotak) ? j.kotak : []).map(bersihKotak).filter(Boolean),
      hantar: (Array.isArray(j.hantar) ? j.hantar : []).map(bersihHantar).filter(Boolean),
      sale: (Array.isArray(j.sale) ? j.sale : []).map(bersihSale).filter(Boolean),
      bank: String(j.bank || '').slice(0, 300),
      kadar: nomborAtauNull(j.kadar) === null ? null : Math.round(Number(j.kadar) * 10000) / 10000,
      markup: nomborAtauNull(j.markup) || 0,      // caj tukaran kad (%) atas kadar pasaran
    };
    return d;
  }

  const eksportData = () => ({
    app: 'diecast', v: 2, diubah: data.diubah, items: data.items, orders: data.orders, kotak: data.kotak,
    hantar: data.hantar, sale: data.sale, bank: data.bank, kadar: data.kadar, markup: data.markup || 0,
  });

  function muat() {
    try {
      const j = JSON.parse(localStorage.getItem(KUNCI) || 'null');
      if (j && Array.isArray(j.items)) {
        const lama = j.v !== 2;
        data = bersihData(j);
        if (lama) simpan({ kekal: true });
      }
    } catch (e) { /* data rosak: mula kosong */ }
  }

  // Buang rujukan yang tergantung (kotak / hantaran / order dipadam).
  function kemasRujukan() {
    const adaK = new Set(data.kotak.map((k) => k.id));
    const adaH = new Set(data.hantar.map((h) => h.id));
    const adaO = new Set(data.orders.map((o) => o.id));
    data.items.forEach((it) => {
      if (it.kotakId && !adaK.has(it.kotakId)) it.kotakId = null;
      if (it.hantarId && !adaH.has(it.hantarId)) it.hantarId = null;
      if (it.orderId && !adaO.has(it.orderId)) it.orderId = null;
    });
    // Hantaran tanpa item: buang.
    const dipakai = new Set(data.items.map((it) => it.hantarId).filter(Boolean));
    data.hantar = data.hantar.filter((h) => dipakai.has(h.id));
  }

  function simpan(opt) {
    kemasRujukan();
    if (!(opt && opt.kekal)) data.diubah = Date.now();
    try { localStorage.setItem(KUNCI, JSON.stringify(eksportData())); } catch (e) { toast('Tidak dapat simpan dalam peranti ini.'); }
    if (!(opt && opt.kekal)) jadualSelaras();
  }

  function muatTetapan() {
    try {
      const j = JSON.parse(localStorage.getItem(KUNCI_TETAPAN) || '{}');
      if (j && typeof j === 'object') tetapan = Object.assign(tetapan, j);
    } catch (e) { /* guna lalai */ }
    const lama = { tunggu: 'beli', personal: 'luar', order: 'otw' };
    if (lama[tetapan.tab]) tetapan.tab = lama[tetapan.tab];
    if (!TAB[tetapan.tab]) tetapan.tab = 'beli';
    if (!['semua', 'belum', 'depo', 'lunas'].includes(tetapan.status)) tetapan.status = 'semua';
  }
  function simpanTetapan() {
    try { localStorage.setItem(KUNCI_TETAPAN, JSON.stringify(tetapan)); } catch (e) { /* tak penting */ }
  }

  /* ---------- Cari rekod dan peringkat ---------- */

  const cariItem = (id) => data.items.find((it) => it.id === id);
  const cariOrder = (id) => data.orders.find((o) => o.id === id);
  const cariKotak = (id) => data.kotak.find((k) => k.id === id);
  const cariHantar = (id) => data.hantar.find((h) => h.id === id);
  const itemOrder = (o) => data.items.filter((it) => it.orderId === o.id);
  const itemKotak = (k) => data.items.filter((it) => it.kotakId === k.id);
  const itemHantar = (h) => data.items.filter((it) => it.hantarId === h.id);

  function peringkat(it) {
    if (it.kat === 'luar') return it.arkib ? 'selesai' : 'luar';
    if (it.arkib) return 'selesai';
    if (it.hantarId) return 'hantar';
    const k = it.kotakId ? cariKotak(it.kotakId) : null;
    if (k && k.tSampai) return 'sampai';
    if (k && k.tPost) return 'post';
    if (k) return 'kotak';
    if (it.tHK) return 'hk';
    if (it.tKeHK) return 'keHK';
    if (it.tHub) return 'hub';
    if (it.tShip) return 'ship';
    return 'beli';
  }
  const tabItem = (it) => (it.kat === 'luar' ? (it.arkib ? 'arkib' : 'luar') : TAB_PERINGKAT[peringkat(it)]);

  function namaKotak(k) { return k.no || ('Kotak ' + tarikh(k.tBuat)); }
  function labelKotak(k) { return k.tSampai ? 'Tiba di Malaysia' : k.tPost ? 'Dipost ke MY' : 'Tunggu tracking Skynet'; }
  function tahapKotak(k) { return k.tSampai ? 'sampai' : k.tPost ? 'post' : 'kotak'; }
  function labelOrder(o) { return (o.no || 'Tanpa no.') + (o.kedai && o.kedai !== 'Mattel Creations' ? ' · ' + o.kedai : ''); }

  /* ---------- Kos dan untung ---------- */

  // Kos beli item dalam mata wang order (seunit x qty).
  const beliAsal = (it) => (it.beli === null ? null : bulat(it.beli * it.qty));

  function kosItem(it) {
    const o = it.orderId ? cariOrder(it.orderId) : null;
    const r = { barang: null, shipCM: 0, bns: 0, jnt: 0, jumlah: null, lengkap: false };
    if (o && it.beli !== null && o.kadar) {
      r.barang = bulat(beliAsal(it) * o.kadar);
      const asas = itemOrder(o).reduce((j, x) => j + (beliAsal(x) || 0), 0);
      if (o.ship && asas > 0) r.shipCM = bulat(o.ship * (beliAsal(it) / asas) * o.kadar);
    } else if (it.modal !== null) {
      r.barang = it.modal;
    }
    if (r.barang === null) return r;
    const darat = r.barang + r.shipCM;
    // Kos BNS dan J&T dibahagi ikut kos barang + shipping CM.
    const bahagi = (jumlah, senarai) => {
      if (!jumlah) return 0;
      const berat = senarai.map((x) => { const k = kosDarat(x); return k === null ? null : k; });
      if (berat.some((b) => b === null)) {
        // Ada item tanpa kos: bahagi sama rata ikut unit.
        const unit = senarai.reduce((j, x) => j + x.qty, 0);
        return bulat(jumlah * it.qty / unit);
      }
      const total = berat.reduce((j, b) => j + b, 0);
      return total > 0 ? bulat(jumlah * darat / total) : 0;
    };
    const k = it.kotakId ? cariKotak(it.kotakId) : null;
    if (k && k.kos) r.bns = bahagi(k.kos, itemKotak(k));
    const h = it.hantarId ? cariHantar(it.hantarId) : null;
    if (h && h.kos) r.jnt = bahagi(h.kos, itemHantar(h));
    r.jumlah = bulat(r.barang + r.shipCM + r.bns + r.jnt);
    r.lengkap = true;
    return r;
  }

  function kosDarat(it) {
    const o = it.orderId ? cariOrder(it.orderId) : null;
    if (o && it.beli !== null && o.kadar) {
      const asas = itemOrder(o).reduce((j, x) => j + (beliAsal(x) || 0), 0);
      const ship = o.ship && asas > 0 ? o.ship * (beliAsal(it) / asas) : 0;
      return (beliAsal(it) + ship) * o.kadar;
    }
    return it.modal;
  }

  /* ---------- Tema ---------- */

  function gunaTema() {
    const r = document.documentElement;
    if (tetapan.tema === 'gelap') r.setAttribute('data-theme', 'dark');
    else if (tetapan.tema === 'terang') r.setAttribute('data-theme', 'light');
    else r.removeAttribute('data-theme');
    const gelap = tetapan.tema === 'gelap' || (tetapan.tema !== 'terang' && matchMedia('(prefers-color-scheme: dark)').matches);
    document.querySelector('meta[name="theme-color"]').setAttribute('content', gelap ? '#10131B' : '#F3F5F9');
    document.querySelectorAll('#segTema button').forEach((b) => b.classList.toggle('aktif', b.dataset.tema === tetapan.tema));
  }
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', gunaTema);

  /* ---------- Toast ---------- */

  let toastMasa = null;
  function toast(teks, btn) {
    const t = $('toast');
    $('toastTeks').textContent = teks;
    const b = $('toastBtn');
    if (btn) {
      b.textContent = btn.label;
      b.hidden = false;
      b.onclick = () => { t.hidden = true; btn.fn(); };
    } else {
      b.hidden = true;
      b.onclick = null;
    }
    t.hidden = false;
    clearTimeout(toastMasa);
    toastMasa = setTimeout(() => { t.hidden = true; }, btn ? 7000 : 3000);
  }

  /* ---------- Dialog dan butang Back telefon ---------- */

  // Setiap helaian yang dibuka ditambah ke sejarah browser, supaya butang Back
  // pada telefon menutup helaian itu dan bukan keluar dari apps.
  const tindan = [];
  let abaikanPop = 0;
  let pushTertunda = 0;

  function buka(dlg) {
    if (dlg.open) return;
    dlg.showModal();
    tindan.push(dlg);
    // Kalau history.back() dari helaian yang baru ditutup belum selesai, push selepas ia selesai.
    if (abaikanPop > 0) pushTertunda++;
    else history.pushState({ diecast: tindan.length }, '');
  }

  function tutup(dlg) { if (dlg.open) dlg.close(); }

  document.querySelectorAll('dialog.helai').forEach((dlg) => {
    dlg.addEventListener('close', () => {
      const i = tindan.indexOf(dlg);
      if (i < 0) return;
      tindan.splice(i, 1);
      if (dlg.dataset.pop === '1') { dlg.dataset.pop = ''; return; }
      abaikanPop++;
      history.back();
    });
    dlg.addEventListener('click', (e) => { if (e.target === dlg) tutup(dlg); });
  });

  window.addEventListener('popstate', () => {
    if (abaikanPop > 0) {
      abaikanPop--;
      if (abaikanPop === 0) for (; pushTertunda > 0; pushTertunda--) history.pushState({ diecast: tindan.length }, '');
      return;
    }
    if ($('dlgSah').open) { $('dlgSah').close('b'); }
    const atas = tindan[tindan.length - 1];
    if (atas) { atas.dataset.pop = '1'; atas.close(); }
  });

  // Pengesahan dengan butang pilihan. Pulangkan nilai butang, atau null bila dibatalkan.
  function tanya(o) {
    return new Promise((ok) => {
      const d = $('dlgSah');
      $('sahTajuk').textContent = o.tajuk;
      $('sahTeks').textContent = o.teks || '';
      const kotak = $('sahBtn');
      kotak.innerHTML = '';
      const btns = o.butang || [{ nilai: 'batal', label: 'Batal' }, { nilai: 'ya', label: o.ya || 'Ya', kelas: o.bahaya ? 'bahaya' : 'utama' }];
      btns.forEach((b) => {
        const el = document.createElement('button');
        el.className = 'btn' + (b.kelas ? ' ' + b.kelas : '');
        el.value = b.nilai;
        el.textContent = b.label;
        kotak.appendChild(el);
      });
      d.returnValue = '';
      d.onclose = () => { d.onclose = null; const v = d.returnValue; ok(v && v !== 'batal' ? v : null); };
      d.showModal();
    });
  }
  const sahkan = (o) => tanya(o).then((v) => v === 'ya');

  // Lukis semula senarai dan apa-apa helaian yang sedang terbuka.
  function segarSemua() {
    papar();
    if ($('dlgButir').open) paparButir();
    if ($('dlgOrder').open) paparOrder();
    if ($('dlgKotak').open) paparKotak();
    if ($('dlgKastemer').open) paparKastemer(kastemerKunci);
    if ($('dlgPanel').open && panelLukis) panelLukis();
  }

  // Simpan, lukis semula, dan tawar "Buat asal" yang memulihkan salinan data sebelum perubahan.
  function ubah(fn, mesej) {
    const sebelum = JSON.stringify(eksportData());
    const hasil = fn();
    simpan();
    segarSemua();
    if (mesej) {
      toast(typeof mesej === 'function' ? mesej(hasil) : mesej, {
        label: 'Buat asal',
        fn: () => { data = bersihData(JSON.parse(sebelum)); simpan(); segarSemua(); toast('Dibatalkan.'); },
      });
    }
    return hasil;
  }

  async function salin(teks) {
    try { await navigator.clipboard.writeText(teks); toast('Disalin: ' + teks); }
    catch (e) { toast(teks); }
  }

  /* ---------- Ikon ---------- */

  const IKON_WA = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm0 18.2c-1.5 0-3-.4-4.3-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.3-.4.2-.4.7-1.4.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5c-.2 0-.4.1-.7.3-.2.2-.9.9-.9 2.2s1 2.6 1.1 2.7c.1.2 1.9 2.9 4.6 4 1.7.7 2.4.8 3.2.7.5-.1 1.5-.6 1.8-1.2.2-.6.2-1.1.1-1.2l-.4-.3z"/></svg>';
  const IKON_BUANG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';
  const IKON_SALIN = '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3"/></svg>';

  /* ---------- Senarai utama ---------- */

  function padanCari(it) {
    if (!cari) return true;
    const o = it.orderId ? cariOrder(it.orderId) : null;
    const k = it.kotakId ? cariKotak(it.kotakId) : null;
    const h = it.hantarId ? cariHantar(it.hantarId) : null;
    const s = [it.nama, it.jenis, it.orang, it.tel, it.catatan, it.trackUS,
      o ? o.no + ' ' + o.kedai : '', k ? namaKotak(k) + ' ' + k.trackMY : '', h ? h.track : ''].join(' ').toLowerCase();
    return cari.toLowerCase().split(/\s+/).every((x) => s.includes(x));
  }
  const padanStatus = (it) => tetapan.status === 'semua' || status(it) === tetapan.status;
  const urut = (a, b) => (a.urutan - b.urutan) || (a.dibuat - b.dibuat);

  function itemTab(tab) { return data.items.filter((it) => tabItem(it) === tab); }

  function paparTab() {
    const arkib = tetapan.tab === 'arkib';
    $('tab').hidden = arkib;
    $('tajukArkib').hidden = !arkib;
    document.querySelectorAll('#tab button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.kat === tetapan.tab)));
    ['beli', 'otw', 'sampai', 'hantar', 'luar'].forEach((k) => {
      document.querySelector('[data-kira="' + k + '"]').textContent = itemTab(k).length;
    });
    document.querySelectorAll('#cip button').forEach((b) => b.classList.toggle('aktif', b.dataset.status === tetapan.status));
    const fab = { beli: 'Tempahan baru', otw: 'Consolidate', luar: 'Tambah item' }[tetapan.tab];
    $('btnTambah').hidden = !fab;
    if (fab) { $('fabTeks').textContent = fab; $('btnTambah').setAttribute('aria-label', fab); }
  }

  function paparRingkas(senarai) {
    const luar = tetapan.tab === 'luar';
    const wangItem = luar ? senarai : senarai.filter((it) => it.kat === 'jual');
    const jumlah = bulat(wangItem.reduce((j, it) => j + (Number(it.harga) || 0), 0));
    const bayar = bulat(wangItem.reduce((j, it) => j + dibayar(it), 0));
    const bk = bakiPositif(wangItem);
    $('ringkas').innerHTML =
      '<div class="kotak"><span class="label">' + senarai.length + ' item</span><span class="nilai">' + rm(jumlah) + '</span></div>' +
      '<div class="kotak"><span class="label">' + (luar ? 'Telah dibayar' : 'Diterima') + '</span><span class="nilai">' + rm(bayar) + '</span></div>' +
      '<div class="kotak baki' + (bk <= 0 ? ' sifar' : '') + '"><span class="label">' + (luar ? 'Baki perlu dibayar' : 'Baki') + '</span><span class="nilai">' + rm(bk) + '</span></div>';
  }

  // Bila item masuk peringkat semasa, dan berapa hari sudah di situ.
  const LABEL_TAHAN = {
    beli: 'Belum ship', ship: 'Ke gudang', hub: 'Di gudang', keHK: 'Ke hub', hk: 'Di hub',
    kotak: 'Tunggu Skynet', post: 'Ke Malaysia', sampai: 'Belum dihantar', hantar: 'Dalam penghantaran',
  };
  const TAHAN = { beli: 1, hub: 1, hk: 1, kotak: 1, sampai: 1 }; // peringkat yang bergantung pada tindakan sendiri
  function masukPeringkat(it, p) {
    const o = it.orderId ? cariOrder(it.orderId) : null;
    const k = it.kotakId ? cariKotak(it.kotakId) : null;
    const h = it.hantarId ? cariHantar(it.hantarId) : null;
    return {
      beli: o && o.tBeli, ship: it.tShip, hub: it.tHub, keHK: it.tKeHK, hk: it.tHK,
      kotak: k && k.tBuat, post: k && k.tPost, sampai: k && k.tSampai, hantar: h && h.t,
    }[p] || null;
  }
  function hariPeringkat(it) {
    const p = peringkat(it);
    const t = LABEL_TAHAN[p] ? masukPeringkat(it, p) : null;
    if (!t) return null;
    const hari = bilHari(t);
    return { p, hari, label: LABEL_TAHAN[p], lama: !!TAHAN[p] && hari >= 7 };
  }
  // Jumlah hari dari order CM hingga selesai (atau hingga hari ini).
  function hariKeseluruhan(it) {
    const o = it.orderId ? cariOrder(it.orderId) : null;
    return o && o.tBeli ? bilHari(o.tBeli, it.arkib || Date.now()) : null;
  }
  const teksHari = (n) => n + ' hari';

  function barisPeringkat(it) {
    const p = peringkat(it);
    if (p === 'luar' || p === 'selesai') return '';
    const o = it.orderId ? cariOrder(it.orderId) : null;
    let teks = PERINGKAT[p];
    const k = it.kotakId ? cariKotak(it.kotakId) : null;
    const hp = hariPeringkat(it);
    if (hp) teks += ' · ' + teksHari(hp.hari);
    if (['ship', 'hub', 'keHK', 'hk'].includes(p) && it.trackUS) teks += ' · ' + it.trackUS;
    else if (o && o.no) teks += ' · ' + o.no;
    return '<div class="kad-tahap' + (hp && hp.lama ? ' lama' : '') + '"><span class="tahap-titik t-' + p + '"></span>' + esc(teks) + '</div>';
  }

  function htmlKad(it, opt) {
    opt = opt || {};
    const st = status(it);
    const h = Number(it.harga) || 0;
    const b = dibayar(it);
    const bk = baki(it);
    let wangH = '';
    if (h > 0 || b > 0) {
      wangH = '<div class="kad-wang"><span>' + (it.kat === 'jual' ? 'Jual' : 'Harga') + ' <b>' + rm(h) + '</b></span>' +
        '<span>Bayar <b>' + rm(b) + '</b></span>' +
        (bk > 0 ? '<span class="baki">Baki <b>' + rm(bk) + '</b></span>' : '') +
        (bk < 0 ? '<span>Lebih <b>' + rm(-bk) + '</b></span>' : '') + '</div>';
    }
    const aku = it.kat === 'aku';
    const pil = aku ? '<span class="pil st-aku">Sendiri</span>' : '<span class="pil st-' + st + '">' + STATUS[st] + '</span>';
    let bawah = opt.peringkat === false ? '' : barisPeringkat(it);
    const pk = peringkat(it);
    const bolehUndur = opt.undur && ['ship', 'hub', 'keHK', 'hk', 'kotak', 'post', 'sampai', 'hantar'].includes(pk);
    if (opt.peringkat === false && !it.arkib) {
      const hp = hariPeringkat(it);
      if (hp) bawah += '<div class="kad-hari' + (hp.lama ? ' lama' : '') + '">' + esc(hp.label) + ' · ' + teksHari(hp.hari) + '</div>';
    }
    const sl = !it.orderId && !it.arkib ? saleUntuk(it) : null;
    if (sl) bawah += '<div class="kad-sale">Sale ' + esc(masaZon(sl.t, 'MY')) + '</div>';
    if (it.arkib) {
      const hk = hariKeseluruhan(it);
      bawah += '<div class="kad-catatan">Selesai ' + tarikh(it.arkib) + (hk !== null ? ' · ' + teksHari(hk) + ' keseluruhan' : '') + '</div>';
    }
    else if (it.catatan) bawah += '<div class="kad-catatan">' + esc(it.catatan) + '</div>';
    const bolehLeret = !it.arkib;
    const sg = srcGambar(it.gambar);
    return '<div class="kad-bungkus"' + (bolehLeret ? ' data-leret="' + esc(it.id) + '"' : '') + '>' +
      (bolehLeret ? '<div class="leret-latar" aria-hidden="true"><span class="l-kanan">✓ Bayar penuh</span><span class="l-kiri">Selesai · arkib ✓</span></div>' : '') +
      '<button type="button" class="kad st-' + (aku ? 'aku' : st) + (sg ? ' ada-gambar' : '') + '" data-id="' + esc(it.id) + '">' +
      (sg ? '<img class="kad-gambar" src="' + esc(sg) + '" alt="" loading="lazy" draggable="false">' : '') +
      '<div class="kad-atas"><div class="kad-nama">' +
      (it.jenis ? '<span class="jenis">' + esc(it.jenis) + '</span>' : '') + esc(it.nama) +
      (it.qty > 1 ? ' <span class="qty">×' + it.qty + '</span>' : '') + '</div>' + pil + '</div>' +
      (opt.orang && !aku ? '<div class="kad-orang">' + esc(it.orang || '-') + '</div>' : '') +
      wangH + bawah + '</button>' +
      (bolehUndur ? '<button type="button" class="undur-kad" data-undur="' + esc(it.id) + '" title="Undur satu peringkat" aria-label="Undur satu peringkat">' +
        '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/></svg></button>' : '') +
      '</div>';
  }

  /* ---------- Leret kad ---------- */

  // Leret ke kanan: rekod bayaran penuh (ada pengesahan).
  // Leret ke kiri: barang dah diserah, masuk Arkib (ada Buat asal).
  let leret = null;
  let abaikanKlik = false;
  const JARAK_LERET = 90;

  $('senarai').addEventListener('pointerdown', (e) => {
    const b = e.target.closest('[data-leret]');
    if (!b || e.button > 0 || e.target.closest('[data-g]') || e.target.closest('[data-undur]')) return;
    leret = { b, kad: b.querySelector('.kad'), x: e.clientX, y: e.clientY, dx: 0, aktif: false, id: e.pointerId };
  });
  $('senarai').addEventListener('pointermove', (e) => {
    if (!leret || e.pointerId !== leret.id) return;
    const dx = e.clientX - leret.x;
    const dy = e.clientY - leret.y;
    if (!leret.aktif) {
      if (Math.abs(dx) > 12 && Math.abs(dx) > Math.abs(dy) * 1.5) {
        leret.aktif = true;
        try { leret.kad.setPointerCapture(e.pointerId); } catch (err) { /* tak penting */ }
        leret.b.classList.add('sedang-leret');
      } else if (Math.abs(dy) > 12) { leret = null; return; }
      else return;
    }
    leret.dx = dx;
    leret.kad.style.transform = 'translateX(' + dx + 'px)';
    leret.b.dataset.arah = dx > 0 ? 'kanan' : 'kiri';
    leret.b.classList.toggle('cukup', Math.abs(dx) >= JARAK_LERET);
  });
  function tamatLeret() {
    if (!leret) return;
    const { b, kad, dx, aktif } = leret;
    leret = null;
    if (!aktif) return;
    abaikanKlik = true;
    setTimeout(() => { abaikanKlik = false; }, 400);
    kad.style.transition = 'transform 0.18s ease';
    kad.style.transform = '';
    setTimeout(() => { kad.style.transition = ''; b.classList.remove('sedang-leret', 'cukup'); delete b.dataset.arah; }, 200);
    const it = cariItem(b.dataset.leret);
    if (!it || Math.abs(dx) < JARAK_LERET) return;
    if (dx > 0) leretBayar(it); else leretArkib(it);
  }
  $('senarai').addEventListener('pointerup', tamatLeret);
  $('senarai').addEventListener('pointercancel', tamatLeret);

  async function leretBayar(it) {
    const bk = baki(it);
    if (bk <= 0) { toast(it.harga > 0 ? labelItem(it) + ' telah dibayar penuh.' : labelItem(it) + ' belum ada harga.'); return; }
    const siapa = it.kat === 'jual' ? it.orang : 'aku';
    const ok = await sahkan({
      tajuk: 'Bayar penuh?',
      teks: 'Rekod bayaran baki ' + rm(bk) + ' dari ' + siapa + ' untuk ' + labelItem(it) + '.',
      ya: 'Rekod ' + rm(bk),
    });
    if (!ok) return;
    ubah(() => { it.bayaran.push({ id: idBaru(), amaun: bk, t: Date.now(), nota: 'Bayar penuh' }); }, rm(bk) + ' direkod. ' + labelItem(it) + ' telah dibayar penuh.');
  }

  function leretArkib(it) {
    ubah(() => {
      it.arkib = Date.now();
      const h = it.hantarId ? cariHantar(it.hantarId) : null;
      if (h && itemHantar(h).every((x) => x.arkib)) h.tTerima = it.arkib;
    }, labelItem(it) + (baki(it) > 0 ? ' diarkib (masih baki ' + rm(baki(it)) + ').' : ' diarkib.'));
  }

  // Kumpulan dalam senarai: kepala (boleh diketuk) + butang aksi + kad item.
  function htmlKumpulan(o) {
    const kad = o.items.map((it) => htmlKad(it, o.kad)).join('');
    return '<section class="kump' + (o.kelas ? ' ' + o.kelas : '') + '">' +
      '<div class="kump-kepala">' +
      '<button type="button" class="kump-tajuk"' + (o.buka ? ' data-buka="' + esc(o.buka) + '"' : ' disabled') + '>' +
      (o.titik ? '<span class="tahap-titik t-' + o.titik + '"></span>' : '') +
      '<span><b>' + esc(o.tajuk) + '</b>' + (o.sub ? '<small>' + o.sub + '</small>' : '') + '</span>' +
      (o.buka ? '<span class="anak">›</span>' : '') + '</button>' +
      (o.aksi && o.aksi.length ? '<div class="kump-aksi">' + o.aksi.map((a) =>
        '<button type="button" class="btn kecil' + (a.kelas ? ' ' + a.kelas : '') + '" data-g="' + esc(a.g) + '"' +
        (a.nilai ? ' data-v="' + esc(a.nilai) + '"' : '') + '>' + a.label + '</button>').join('') + '</div>' : '') +
      '</div>' + (o.jejak && o.jejak.no ? '<div class="kump-jejak">' + htmlNoJejak(o.jejak.no, o.jejak.jenis) + '</div>' : '') + kad + '</section>';
  }

  function ikutOrang(senarai) {
    const peta = new Map();
    senarai.forEach((it) => {
      const k = kunciOrang(it.orang) || '-';
      if (!peta.has(k)) peta.set(k, { kunci: k, nama: it.orang || 'Tanpa nama', items: [] });
      peta.get(k).items.push(it);
    });
    return [...peta.values()];
  }

  // Untung item jual: hanya dikira bila kos lengkap.
  function kiraUntung(its) {
    return its.reduce((g, it) => {
      g.n++;
      if (it.kat !== 'jual') return g;
      const k = kosItem(it);
      if (k.lengkap) { g.jual += it.harga; g.kos += k.jumlah; g.untung += it.harga - k.jumlah; g.ada++; } else g.tak++;
      return g;
    }, { n: 0, ada: 0, jual: 0, kos: 0, untung: 0, tak: 0 });
  }
  const tahunDari = (ms) => new Date(ms).getFullYear();
  // Senarai tahun (terbaru dulu, tahun semasa sentiasa ada) dan tahun yang dipilih.
  function pilihTahun(its, simpanan) {
    const kini = new Date().getFullYear();
    const ada = [...new Set(its.map((it) => tahunDari(it.arkib)).concat(kini))].sort((a, b) => b - a);
    const pilih = simpanan === 'semua' || ada.includes(simpanan) ? simpanan : kini;
    return { ada, pilih };
  }
  function htmlCipTahun(t, attr) {
    return '<div class="cip cip-tahun" role="group" aria-label="Tahun">' + t.ada.concat('semua').map((y) =>
      '<button type="button" ' + attr + '="' + y + '"' + (y === t.pilih ? ' class="aktif"' : '') + '>' + (y === 'semua' ? 'Semua' : y) + '</button>').join('') + '</div>';
  }
  const bulanBuka = new Map(); // kunci bulan Arkib -> terbuka?

  function papar() {
    paparTab();
    $('bannerLogin').hidden = selaras.aktif || !!tetapan.tutupBanner || !data.items.length;
    paparBannerSale();
    const tab = tetapan.tab;
    const ada = data.items.length > 0 || data.orders.length > 0;
    $('kosongMula').hidden = ada;
    $('tapisBar').hidden = !ada;
    $('ringkas').hidden = !ada;
    if (!ada) { $('tab').hidden = true; $('senarai').innerHTML = ''; return; }

    let semua = itemTab(tab).filter(padanCari);
    let arkibT = null;
    if (tab === 'arkib') {
      // Arkib dipaparkan ikut tahun. Carian merangkumi semua tahun.
      arkibT = pilihTahun(itemTab('arkib'), tetapan.arkibTahun);
      if (!cari && arkibT.pilih !== 'semua') semua = semua.filter((it) => tahunDari(it.arkib) === arkibT.pilih);
    }
    paparRingkas(semua);
    const nampak = semua.filter(padanStatus);
    const ditapis = !!cari || tetapan.status !== 'semua';
    let html = '';

    if (tab === 'beli') {
      // Butang Order CM ada pada kumpulan "Belum dibeli"; bar ini hanya bila kumpulan itu tiada.
      if (!nampak.some((it) => !it.orderId)) html += '<div class="bar-aksi"><button type="button" class="btn kecil utama" data-g="orderCM">+ Order CM</button></div>';
      const kump = new Map();
      nampak.sort(urut).forEach((it) => {
        const k = it.orderId || '-';
        if (!kump.has(k)) kump.set(k, []);
        kump.get(k).push(it);
      });
      [...kump.entries()].sort((a, b) => {
        const oa = cariOrder(a[0]); const ob = cariOrder(b[0]);
        return (oa ? oa.tBeli : -Infinity) - (ob ? ob.tBeli : -Infinity) || 0;
      }).forEach(([k, its]) => {
        const o = cariOrder(k);
        html += htmlKumpulan({
          tajuk: o ? labelOrder(o) : 'Belum dibeli',
          sub: o ? 'Dibeli ' + tarikh(o.tBeli) + (o.akaun ? ' · ' + esc(o.akaun) : '') + ' · ' + bilHari(o.tBeli) + ' hari' : its.length + ' item belum ada order CM',
          buka: o ? 'order:' + o.id : '',
          items: its,
          kad: { orang: true, peringkat: false },
          aksi: o ? [{ g: 'declare', nilai: k, label: 'Declare' }]
            : (itemTanpaSale().length ? [{ g: 'sale', nilai: '-', label: 'Sale' }] : []).concat({ g: 'orderCM', nilai: '-', label: 'Order CM', kelas: 'utama' }),
        });
      });
    } else if (tab === 'otw') {
      // Kotak dulu, kemudian di hub, kemudian dalam perjalanan ke hub.
      const kotak = data.kotak.filter((k) => !k.tSampai).sort((a, b) => a.tBuat - b.tBuat);
      kotak.forEach((k) => {
        const its = nampak.filter((it) => it.kotakId === k.id);
        if (!its.length && (ditapis || itemKotak(k).length)) return;
        html += htmlKumpulan({
          kelas: 'kump-kotak t-' + tahapKotak(k),
          titik: tahapKotak(k),
          tajuk: namaKotak(k),
          sub: esc(labelKotak(k)) + (k.trackMY ? ' · Skynet ' + esc(k.trackMY) : '') + (k.tPost ? ' · ' + bilHari(k.tPost) + ' hari' : ''),
          buka: 'kotak:' + k.id,
          items: its,
          kad: { orang: true, peringkat: false, undur: true },
          jejak: k.trackMY ? { no: k.trackMY, jenis: 'skynet' } : null,
          aksi: [k.tPost ? { g: 'sampaiMY', nilai: k.id, label: 'Tiba di Malaysia', kelas: 'utama' } : { g: 'skynet', nilai: k.id, label: 'Tracking Skynet', kelas: 'utama' }],
        });
      });
      const senaraiId = (its) => its.map((it) => it.id).join(',');
      const kumpPeringkat = (p, tajuk, sub, aksi) => {
        const its = nampak.filter((it) => peringkat(it) === p);
        if (!its.length) return;
        html += htmlKumpulan({ titik: p, tajuk, sub: its.length + ' item' + (sub ? ' · ' + sub : ''), items: its, kad: { orang: true, undur: true }, aksi: aksi(its) });
      };
      kumpPeringkat('hk', 'Hub', 'sedia consolidate', () => [{ g: 'kotakBaru', nilai: 'hk', label: 'Consolidate', kelas: 'utama' }]);
      kumpPeringkat('keHK', 'Gudang → Hub', '', (its) => [{ g: 'hk', nilai: senaraiId(its), label: 'Tiba di hub', kelas: 'utama' }]);
      kumpPeringkat('hub', 'Gudang', '', (its) => [{ g: 'keHK', nilai: senaraiId(its), label: 'Hantar ke hub' }, { g: 'hk', nilai: senaraiId(its), label: 'Tiba di hub' }]);
      const keHub = nampak.filter((it) => peringkat(it) === 'ship');
      const parcel = new Map();
      keHub.forEach((it) => {
        const k = it.trackUS || (it.lama ? '\u0000lama' : '');
        if (!parcel.has(k)) parcel.set(k, []);
        parcel.get(k).push(it);
      });
      [...parcel.entries()].forEach(([trk, its]) => {
        const tMin = Math.min(...its.map((it) => it.tShip || Date.now()));
        html += htmlKumpulan({
          titik: 'ship',
          tajuk: trk === '\u0000lama' ? 'Dalam transit · data lama' : trk ? 'Ke gudang · ' + trk : 'Ke gudang · tanpa tracking',
          sub: trk === '\u0000lama' ? 'Tiada butiran perjalanan · masukkan ke kotak apabila diketahui' :
            'Ship ' + tarikh(tMin) + ' · ' + bilHari(tMin) + ' hari' + (its.some((it) => !it.tDeclare) ? ' · <span class="tag-amaran">Belum declare</span>' : ''),
          items: its, kad: { orang: true, peringkat: false, undur: true },
          jejak: trk && trk !== '\u0000lama' ? { no: trk, jenis: 'us' } : null,
          aksi: [{ g: 'undur', nilai: its.map((it) => it.id).join(','), label: 'Pulangkan' }, { g: 'hub', nilai: its.map((it) => it.id).join(','), label: 'Tiba di gudang' }],
        });
      });
    } else if (tab === 'sampai') {
      ikutOrang(nampak).sort((a, b) => (a.kunci === AKU) - (b.kunci === AKU) || a.nama.localeCompare(b.nama)).forEach((g) => {
        const aku = g.kunci === AKU;
        const bk = bakiPositif(g.items);
        const aksi = [];
        if (!aku && bk > 0) aksi.push({ g: 'waBaki', nilai: g.kunci, label: IKON_WA + 'Baki' });
        aksi.push(aku ? { g: 'ambil', nilai: g.items.map((it) => it.id).join(','), label: 'Diterima', kelas: 'utama' }
          : { g: 'serah', nilai: g.kunci, label: 'Hantar', kelas: 'utama' });
        html += htmlKumpulan({
          tajuk: aku ? 'Barang sendiri' : g.nama,
          sub: g.items.length + ' item' + (bk > 0 && !aku ? ' · baki <b>' + rm(bk) + '</b>' : ''),
          buka: aku ? '' : 'orang:' + g.kunci,
          items: g.items, kad: { peringkat: false },
          aksi,
        });
      });
    } else if (tab === 'hantar') {
      const kump = new Map();
      nampak.forEach((it) => {
        if (!kump.has(it.hantarId)) kump.set(it.hantarId, []);
        kump.get(it.hantarId).push(it);
      });
      [...kump.entries()].map(([id, its]) => ({ h: cariHantar(id), its })).filter((x) => x.h)
        .sort((a, b) => a.h.t - b.h.t).forEach(({ h, its }) => {
          const bk = bakiPositif(its);
          html += htmlKumpulan({
            tajuk: h.orang,
            sub: (h.cara === 'pos' ? 'J&T' : 'Hantar sendiri') + ' · ' + tarikh(h.t) +
              (bk > 0 ? ' · baki <b>' + rm(bk) + '</b>' : ''),
            buka: 'hantar:' + h.id,
            items: its, kad: { peringkat: false, undur: true, orang: new Set(its.map((it) => kunciOrang(it.orang))).size > 1 },
            jejak: h.cara === 'pos' && h.track ? { no: h.track, jenis: 'jnt' } : null,
            aksi: [{ g: 'waHantar', nilai: h.id, label: IKON_WA + 'Mesej' }, { g: 'terima', nilai: h.id, label: 'Diterima', kelas: 'utama' }],
          });
        });
    } else if (tab === 'luar') {
      ikutOrang(nampak.sort(urut)).forEach((g) => {
        const bk = bakiPositif(g.items);
        html += htmlKumpulan({ tajuk: g.nama, sub: g.items.length + ' item' + (bk > 0 ? ' · baki perlu dibayar <b>' + rm(bk) + '</b>' : ''), items: g.items, kad: {} });
      });
    } else if (tab === 'arkib') {
      if (!cari) html += htmlCipTahun(arkibT, 'data-arkib-tahun');
      const kump = new Map();
      nampak.sort((a, b) => b.arkib - a.arkib).forEach((it) => {
        const d = new Date(it.arkib);
        const k = d.getFullYear() * 100 + d.getMonth();
        if (!kump.has(k)) kump.set(k, { label: BULAN[d.getMonth()] + ' ' + d.getFullYear(), items: [] });
        kump.get(k).items.push(it);
      });
      let pertama = true;
      kump.forEach((g, k) => {
        const u = kiraUntung(g.items);
        const hs = g.items.map(hariKeseluruhan).filter((x) => x !== null);
        const purata = hs.length ? Math.round(hs.reduce((a, b) => a + b, 0) / hs.length) : null;
        const buka = ditapis || (bulanBuka.has(k) ? bulanBuka.get(k) : pertama);
        pertama = false;
        html += '<details class="kump kump-bulan" data-bulan="' + k + '"' + (buka ? ' open' : '') + '><summary class="kump-tajuk">' +
          '<span><b>' + esc(g.label) + '</b><small>' + g.items.length + ' item' + (u.ada ? ' · jual ' + rm(u.jual) + ' · untung <span class="' + (u.untung < 0 ? 'rugi' : 'untung') + '">' + rm(u.untung) + '</span>' : '') +
          (u.tak ? ' · ' + u.tak + ' tanpa kos' : '') + (purata !== null ? ' · purata ' + teksHari(purata) : '') + '</small></span><span class="anak">›</span></summary>' +
          g.items.map((it) => htmlKad(it, { orang: true, peringkat: false })).join('') + '</details>';
      });
    }

    if (!nampak.length) {
      const kosong = ditapis ? 'Tiada item yang padan.' : {
        beli: 'Tiada tempahan. Tekan Tempahan baru apabila pelanggan membuat tempahan.',
        otw: 'Tiada barang dalam perjalanan.',
        sampai: 'Tiada barang yang sedang menunggu untuk diserah.',
        hantar: 'Tiada barang yang sedang dihantar.',
        luar: 'Tiada barang peribadi. Bahagian ini untuk barang yang dibeli daripada pihak lain.',
        arkib: 'Belum ada item selesai.',
      }[tab];
      if (tab !== 'beli' && !(tab === 'arkib' && !cari)) html = '';
      const kosongArkib = tab === 'arkib' && !ditapis && itemTab('arkib').length && arkibT.pilih !== 'semua' ? 'Tiada item selesai pada ' + arkibT.pilih + '.' : '';
      html += '<p class="kosong">' + esc(kosongArkib || kosong) + '</p>';
    }
    $('senarai').innerHTML = html;
  }

  $('senarai').addEventListener('toggle', (e) => {
    const d = e.target;
    if (d.matches && d.matches('details[data-bulan]')) bulanBuka.set(Number(d.dataset.bulan), d.open);
  }, true);
  $('senarai').addEventListener('click', (e) => {
    if (abaikanKlik) { abaikanKlik = false; return; }
    const ty = e.target.closest('[data-arkib-tahun]');
    if (ty) {
      const v = ty.dataset.arkibTahun;
      tetapan.arkibTahun = v === 'semua' ? v : Number(v);
      simpanTetapan();
      papar();
      return;
    }
    const sal = e.target.closest('[data-salin]');
    if (sal) { salin(sal.dataset.salin); return; }
    if (e.target.closest('a.no-jejak')) return;
    const u = e.target.closest('[data-undur]');
    if (u) {
      const it = cariItem(u.dataset.undur);
      if (!it) return;
      let ke = '';
      ubah(() => { ke = undurSatu(it); }, () => labelItem(it) + ' diundur: ' + PERINGKAT[ke] + '.');
      return;
    }
    const g = e.target.closest('[data-g]');
    if (g) { aksiKumpulan(g.dataset.g, g.dataset.v || ''); return; }
    const t = e.target.closest('[data-buka]');
    if (t) {
      const [jenis, id] = t.dataset.buka.split(':');
      if (jenis === 'order') bukaOrder(id);
      else if (jenis === 'kotak') bukaKotak(id);
      else if (jenis === 'orang') bukaKastemer(id);
      else if (jenis === 'hantar') borangHantar(cariHantar(id));
      return;
    }
    const k = e.target.closest('.kad');
    if (k) bukaButir(k.dataset.id);
  });

  function aksiKumpulan(g, v) {
    if (g === 'declare') {
      const belum = itemTab('beli');
      borangDeclare([], v && v !== '-' ? v : null);
    }
    else if (g === 'hub') borangTanda(v.split(','), 'tHub', 'Tiba di gudang', 'tiba di gudang.');
    else if (g === 'keHK') borangTanda(v.split(','), 'tKeHK', 'Dihantar ke hub', 'dihantar ke hub.');
    else if (g === 'hk') borangTanda(v.split(','), 'tHK', 'Tiba di hub', 'tiba di hub. Boleh consolidate.');
    else if (g === 'undur') borangUndur(v.split(','));
    else if (g === 'orderCM') borangOrderBaru([]);
    else if (g === 'sale') borangSaleTempahan();
    else if (g === 'senaraiOrder') bukaSenaraiOrder();
    else if (g === 'kotakBaru') borangKotak(null, data.items.filter((it) => peringkat(it) === 'hk').map((it) => it.id));
    else if (g === 'skynet') borangSkynet(cariKotak(v));
    else if (g === 'sampaiMY') borangSampai(cariKotak(v));
    else if (g === 'waBaki') { const its = itemTab('sampai').filter((it) => kunciOrang(it.orang) === v); waBaki(its); }
    else if (g === 'serah') borangSerah(v);
    else if (g === 'ambil') ubah(() => { v.split(',').forEach((id) => { const it = cariItem(id); if (it) it.arkib = Date.now(); }); }, 'Barang sendiri diarkibkan.');
    else if (g === 'waHantar') waHantar(cariHantar(v));
    else if (g === 'terima') terimaHantar(cariHantar(v));
  }

  $('tab').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-kat]');
    if (!b) return;
    tetapan.tab = b.dataset.kat;
    simpanTetapan();
    papar();
    window.scrollTo({ top: 0 });
  });
  $('btnArkib').addEventListener('click', () => { tetapan.tab = 'arkib'; simpanTetapan(); papar(); window.scrollTo({ top: 0 }); });
  $('btnKeluarArkib').addEventListener('click', () => { tetapan.tab = 'beli'; simpanTetapan(); papar(); });

  $('cip').innerHTML = '<button type="button" data-status="semua">Semua</button><button type="button" data-status="belum"><i class="titik s-belum"></i>Belum bayar</button>' +
    '<button type="button" data-status="depo"><i class="titik s-depo"></i>Deposit</button><button type="button" data-status="lunas"><i class="titik s-lunas"></i>Lunas</button>';
  $('cip').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-status]');
    if (!b) return;
    tetapan.status = b.dataset.status;
    simpanTetapan();
    papar();
  });
  $('cari').addEventListener('input', (e) => { cari = e.target.value.trim(); papar(); });

  /* ---------- Borang umum ---------- */

  // o: { tajuk, nota, html, simpan, hantar(form) -> mesej ralat atau '' , lepas(form) }
  let hantarBorang = null;
  let lepasBuka = null;
  function borang(o) {
    const f = $('formX');
    f.innerHTML = '<h2>' + esc(o.tajuk) + '</h2>' + (o.nota ? '<p class="nota">' + o.nota + '</p>' : '') + o.html +
      '<p class="ralat" id="formRalat" role="alert"></p>' +
      '<div class="aksi-bawah"><button class="btn" type="button" data-batal="1">Batal</button>' +
      '<button class="btn utama" type="submit">' + esc(o.simpan || 'Simpan') + '</button></div>';
    hantarBorang = o.hantar;
    lepasBuka = o.lepas || null;
    buka($('dlgForm'));
    $('dlgForm').scrollTop = 0;
    if (lepasBuka) lepasBuka(f);
    const pertama = f.querySelector('[data-fokus]');
    if (pertama) setTimeout(() => pertama.focus(), 50);
  }
  $('formX').addEventListener('click', (e) => {
    if (e.target.closest('[data-batal]')) { tutup($('dlgForm')); return; }
    const ps = e.target.closest('[data-pilih-semua]');
    if (ps) {
      const kotak = [...$('formX').querySelectorAll('.senarai-pilih label:not([hidden]) input[name="' + ps.dataset.pilihSemua + '"]')];
      const semua = kotak.every((x) => x.checked);
      kotak.forEach((x) => { x.checked = !semua; });
      ps.textContent = semua ? 'Tanda semua yang nampak' : 'Buang semua tanda';
    }
  });
  $('formX').addEventListener('submit', (e) => {
    e.preventDefault();
    if (!hantarBorang) return;
    const ralat = hantarBorang(e.target);
    if (ralat) { $('formRalat').textContent = ralat; return; }
    tutup($('dlgForm'));
  });
  $('formX').addEventListener('input', (e) => {
    if (!e.target.matches('[data-tapis-pilih]')) return;
    const q = e.target.value.trim().toLowerCase();
    $('formX').querySelectorAll('.senarai-pilih label, .senarai-tag .tag-baris').forEach((l) => {
      l.hidden = !!q && !l.textContent.toLowerCase().includes(q) && !l.querySelector('input[type="checkbox"]:checked, input[type="radio"]:checked');
    });
  });

  const medanTarikh = (nama, label, ms, wajib) =>
    '<label class="medan">' + label + (wajib ? '' : ' <small>(kosongkan kalau belum)</small>') +
    '<input type="date" name="' + nama + '" value="' + (ms ? tarikhInput(ms) : '') + '"' + (wajib ? ' required' : '') + '></label>';
  const medanTeks = (nama, label, nilai, ext) =>
    '<label class="medan">' + label + '<input name="' + nama + '" value="' + esc(nilai == null ? '' : nilai) + '"' + (ext || '') + '></label>';
  const medanNombor = (nama, label, nilai, ext) =>
    medanTeks(nama, label, nilai, ' type="number" inputmode="decimal" min="0" step="0.01"' + (ext || ''));

  function senaraiPilih(nama, pilihan, jenis) {
    if (!pilihan.length) return '<p class="nota kosong-kecil">Tiada pilihan.</p>';
    return (pilihan.length > 6 ? '<input class="tapis-pilih" type="search" data-tapis-pilih placeholder="Tapis senarai">' : '') +
      ((jenis || 'checkbox') === 'checkbox' && pilihan.length > 1 ? '<button type="button" class="pautan pilih-semua" data-pilih-semua="' + esc(nama) + '">Tanda semua yang nampak</button>' : '') +
      '<div class="senarai-pilih">' + pilihan.map((p) =>
        '<label><input type="' + (jenis || 'checkbox') + '" name="' + nama + '" value="' + esc(p.nilai) + '"' + (p.pilih ? ' checked' : '') + '>' +
        '<span><b>' + esc(p.label) + '</b>' + (p.sub ? '<small>' + esc(p.sub) + '</small>' : '') + '</span></label>').join('') + '</div>';
  }
  const nilaiPilih = (f, nama) => [...f.querySelectorAll('input[name="' + nama + '"]:checked')].map((x) => x.value);

  function pilihanItem(senarai, tanda) {
    const set = new Set(tanda || []);
    return senarai.map((it) => {
      const o = it.orderId ? cariOrder(it.orderId) : null;
      return {
        nilai: it.id,
        label: labelItem(it),
        sub: (it.kat === 'aku' ? 'Sendiri' : it.orang) + (o && o.no ? ' · ' + o.no : '') + (it.trackUS ? ' · ' + it.trackUS : ''),
        pilih: set.has(it.id),
      };
    });
  }

  function isiDatalistOrang() {
    const nama = new Map([[AKU, AKU]]);
    data.items.forEach((it) => { const k = kunciOrang(it.orang); if (k && !nama.has(k)) nama.set(k, it.orang); });
    $('senaraiOrang').innerHTML = [...nama.values()].map((n) => '<option value="' + esc(n) + '">').join('');
  }
  function telUntuk(orang) {
    const k = kunciOrang(orang);
    const ada = data.items.find((it) => kunciOrang(it.orang) === k && it.tel);
    return ada ? ada.tel : '';
  }

  /* ---------- Order baru (banyak item sekali gus) ---------- */

  function htmlBarisOrder(b, tanpaBeli) {
    b = b || {};
    if (tanpaBeli) {
      return '<div class="baris-order" data-tanpa-beli>' +
        '<div class="dua"><label class="medan kecil">Jenis<input name="jenis" list="senaraiJenis" maxlength="20" placeholder="RLC" value="' + esc(b.jenis || '') + '"></label>' +
        '<label class="medan">Item<input name="nama" maxlength="80" placeholder="Contoh: Bumblebee" value="' + esc(b.nama || '') + '"></label></div>' +
        '<div class="dua"><label class="medan kecil">Qty<input name="qty" type="number" inputmode="numeric" min="1" step="1" value="' + esc(b.qty || 1) + '"></label>' +
        '<label class="medan">Pelanggan <small>(AKU = sendiri)</small><input name="orang" list="senaraiOrang" maxlength="60" value="' + esc(b.orang || '') + '"></label></div>' +
        '<div class="dua"><label class="medan">Harga jual (RM)<input name="harga" type="number" inputmode="decimal" min="0" step="0.01" value="' + esc(b.harga == null ? '' : b.harga) + '"></label>' +
        '<label class="medan">Telah dibayar (RM) <small>(pilihan)</small><input name="bayar" type="number" inputmode="decimal" min="0" step="0.01" value=""></label></div>' +
        htmlGambarBaris(b.gambar) +
        '<div class="baris-btn"><button type="button" class="btn kecil" data-baris="salin">Salin baris</button>' +
        '<button type="button" class="btn kecil bahaya" data-baris="buang">Buang</button></div></div>';
    }
    return '<div class="baris-order">' +
      '<div class="dua"><label class="medan kecil">Jenis<input name="jenis" list="senaraiJenis" maxlength="20" placeholder="RLC" value="' + esc(b.jenis || '') + '"></label>' +
      '<label class="medan">Item<input name="nama" maxlength="80" placeholder="Contoh: Skyline R32" value="' + esc(b.nama || '') + '"></label></div>' +
      '<div class="dua"><label class="medan kecil">Qty<input name="qty" type="number" inputmode="numeric" min="1" step="1" value="' + esc(b.qty || 1) + '"></label>' +
      '<label class="medan"><span data-label-beli>Harga beli seunit (US$)</span><input name="beli" type="number" inputmode="decimal" min="0" step="0.01" value="' + esc(b.beli == null ? '' : b.beli) + '"></label></div>' +
      '<div class="dua"><label class="medan">Pelanggan <small>(AKU = sendiri)</small><input name="orang" list="senaraiOrang" maxlength="60" value="' + esc(b.orang || '') + '"></label>' +
      '<label class="medan">Harga jual (RM)<input name="harga" type="number" inputmode="decimal" min="0" step="0.01" value="' + esc(b.harga == null ? '' : b.harga) + '"></label></div>' +
      htmlGambarBaris(b.gambar) +
      '<div class="baris-btn"><button type="button" class="btn kecil" data-baris="salin">Salin baris</button>' +
      '<button type="button" class="btn kecil bahaya" data-baris="buang">Buang</button></div></div>';
  }

  function bacaBaris(el) {
    const q = (n) => { const x = el.querySelector('[name="' + n + '"]'); return x ? x.value : ''; };
    return { jenis: q('jenis'), nama: q('nama').trim(), qty: q('qty'), beli: q('beli'), orang: q('orang').trim(), harga: q('harga'), bayar: q('bayar'), gambar: q('gambar') };
  }

  // Gambar dalam baris tempahan / order: pilih dari galeri / kamera, atau tampal pautan.
  function htmlGambarBaris(gambar) {
    return '<div class="gambar-baris"><span class="gb-pratonton">' + (srcGambar(gambar) ? '<img src="' + esc(srcGambar(gambar)) + '" alt="">' : '') + '</span>' +
      '<input type="hidden" name="gambar" value="' + esc(gambar || '') + '">' +
      '<label class="btn kecil"><input type="file" accept="image/*" data-gambar-fail hidden>' + (gambar ? 'Tukar gambar' : '+ Gambar') + '</label>' +
      '<button type="button" class="btn kecil" data-gambar-pautan>Pautan</button>' +
      (gambar ? '<button type="button" class="btn kecil bahaya" data-gambar-buang>Buang</button>' : '') + '</div>';
  }
  function setGambarBaris(baris, v) {
    baris.querySelector('.gambar-baris').outerHTML = htmlGambarBaris(v);
  }
  $('formX').addEventListener('change', async (e) => {
    if (!e.target.matches('[data-gambar-fail]')) return;
    const fail = e.target.files && e.target.files[0];
    const baris = e.target.closest('.baris-order');
    if (!fail || !baris) return;
    try { setGambarBaris(baris, await gambarDariFail(fail)); } catch (err) { toast('Gambar tidak dapat dibaca.'); }
  });
  $('formX').addEventListener('click', (e) => {
    const baris = e.target.closest('.baris-order');
    if (!baris) return;
    if (e.target.closest('[data-gambar-buang]')) setGambarBaris(baris, '');
    else if (e.target.closest('[data-gambar-pautan]')) {
      const v = (window.prompt('Tampal pautan gambar (https://…)', '') || '').trim();
      if (v && /^https?:\/\//.test(v)) setGambarBaris(baris, v);
      else if (v) toast('Pautan gambar mesti bermula dengan https://');
    }
  });

  /* ---------- Tag item tempahan pada order ---------- */

  // Senarai item untuk ditag: setiap baris ada kotak tanda dan harga beli seunit (nampak bila ditanda).
  function htmlTag(calon, o) {
    if (!calon.length) return '<p class="nota kosong-kecil">Tiada item tempahan yang belum ada order. Tambah item lain di bawah, atau masukkan tempahan dulu.</p>';
    return (calon.length > 6 ? '<input class="tapis-pilih" type="search" data-tapis-pilih placeholder="Tapis: nama item atau pelanggan">' : '') +
      '<div class="senarai-tag">' + calon.map((it) => {
        const pilih = o && it.orderId === o.id;
        return '<div class="tag-baris"><label><input type="checkbox" name="tag" value="' + esc(it.id) + '"' + (pilih ? ' checked' : '') + '>' +
          '<span><b>' + esc(labelItem(it)) + '</b><small>' + esc(it.kat === 'aku' ? 'Sendiri' : it.orang) + ' · ' + esc(PERINGKAT[peringkat(it)]) +
          (it.harga ? ' · jual ' + rm(it.harga) : '') + '</small></span></label>' +
          '<label class="tag-beli"><span data-label-beli-pendek>US$ seunit</span><input type="number" inputmode="decimal" min="0" step="0.01" name="beli_' + esc(it.id) + '"' +
          ' data-nama="' + esc(kunciOrang(it.jenis + ' ' + it.nama)) + '" data-qty="' + it.qty + '" value="' + (pilih && it.beli !== null ? it.beli : '') + '"></label></div>';
      }).join('') + '</div>';
  }

  // Item yang boleh ditag: belum ada order (mana-mana peringkat), atau dah dalam order ini.
  function calonTag(o) {
    return data.items.filter((it) => it.kat !== 'luar' && !it.arkib && (!it.orderId || (o && it.orderId === o.id)))
      .sort((a, b) => ((o && b.orderId === o.id) - (o && a.orderId === o.id)) || (peringkat(a) !== 'beli') - (peringkat(b) !== 'beli') ||
        kunciOrang(a.jenis + a.nama).localeCompare(kunciOrang(b.jenis + b.nama)) || a.orang.localeCompare(b.orang));
  }

  function bacaTag(f) {
    return [...f.querySelectorAll('.tag-baris')].map((row) => {
      const cb = row.querySelector('input[name="tag"]');
      const beli = row.querySelector('.tag-beli input');
      return { id: cb.value, pilih: cb.checked, beli: beli.value, qty: Number(beli.dataset.qty) || 1 };
    });
  }

  // Isi harga beli item yang sama nama sendiri, supaya tak perlu taip berulang (contoh 2 Bumblebee).
  function pasangTag(f) {
    const salinHarga = (sumber) => {
      if (sumber.value === '') return;
      f.querySelectorAll('.tag-beli input[data-nama="' + CSS.escape(sumber.dataset.nama) + '"]').forEach((x) => {
        if (x !== sumber && x.value === '' && x.closest('.tag-baris').querySelector('input[name="tag"]').checked) x.value = sumber.value;
      });
    };
    f.querySelectorAll('.tag-beli input').forEach((x) => x.addEventListener('change', () => { salinHarga(x); kiraJumlahOrder(f); }));
    f.querySelectorAll('.tag-baris input[name="tag"]').forEach((cb) => cb.addEventListener('change', () => {
      const beli = cb.closest('.tag-baris').querySelector('.tag-beli input');
      if (cb.checked && beli.value === '') {
        const kawan = [...f.querySelectorAll('.tag-beli input[data-nama="' + CSS.escape(beli.dataset.nama) + '"]')].find((x) => x !== beli && x.value !== '');
        if (kawan) beli.value = kawan.value;
      }
      if (cb.checked) setTimeout(() => beli.focus(), 0);
      kiraJumlahOrder(f);
    }));
  }

  /* ---------- Kadar tukaran ikut tarikh ---------- */

  // Kadar pasaran USD->MYR pada tarikh order. Sumber utama Frankfurter (data ECB; hujung minggu
  // guna hari bekerja sebelumnya), sandaran currency-api di jsDelivr. Disimpan supaya tak ambil dua kali.
  const KUNCI_KADAR = 'diecast-kadar';
  let cacheKadar = {};
  try { cacheKadar = JSON.parse(localStorage.getItem(KUNCI_KADAR) || '{}') || {}; } catch (e) { cacheKadar = {}; }

  async function kadarPasaran(t) {
    const hariIni = tarikhInput();
    const minta = t > hariIni ? hariIni : t;
    if (cacheKadar[minta]) return cacheKadar[minta];
    const cuba = [
      async () => {
        const r = await fetch('https://api.frankfurter.dev/v1/' + minta + '?from=USD&to=MYR');
        if (!r.ok) throw new Error(r.status);
        const j = await r.json();
        return { kadar: j.rates.MYR, tarikh: j.date };
      },
      async () => {
        const r = await fetch('https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@' + minta + '/v1/currencies/usd.min.json');
        if (!r.ok) throw new Error(r.status);
        const j = await r.json();
        return { kadar: j.usd.myr, tarikh: j.date || minta };
      },
    ];
    for (const fn of cuba) {
      try {
        const h = await fn();
        if (h && Number(h.kadar) > 0) {
          const hasil = { kadar: Math.round(Number(h.kadar) * 10000) / 10000, tarikh: h.tarikh };
          // Tarikh hari ini boleh berubah sepanjang hari; simpan hanya tarikh lepas.
          if (minta < hariIni) {
            cacheKadar[minta] = hasil;
            try { localStorage.setItem(KUNCI_KADAR, JSON.stringify(cacheKadar)); } catch (e) { /* tak penting */ }
          }
          return hasil;
        }
      } catch (e) { /* cuba sumber seterusnya */ }
    }
    return null;
  }

  const denganMarkup = (k) => Math.round(k * (1 + (data.markup || 0) / 100) * 10000) / 10000;
  function notaPasaran(h) {
    const d = dariInput(h.tarikh);
    return 'Pasaran ' + tarikh(d) + (data.markup ? ' + ' + data.markup + '% kad' : '');
  }

  // Isi medan kadar ikut tarikh beli. Berhenti isi sendiri bila kadar ditaip sendiri.
  function pasangKadarAuto(f, adaKadar) {
    const inp = f.kadar;
    const nota = f.querySelector('#kadarNota');
    let manual = !!adaKadar;
    let giliran = 0;
    const tulis = (t) => { nota.innerHTML = t; };
    async function ambil(paksa) {
      if (f.mata.value !== 'USD') return;
      if (manual && !paksa) {
        tulis('<button type="button" class="pautan" data-kadar-auto>Guna kadar pasaran tarikh order</button>');
        return;
      }
      const n = ++giliran;
      tulis('Mengambil kadar ' + tarikh(dariInput(f.tBeli.value)) + '…');
      const h = await kadarPasaran(f.tBeli.value || tarikhInput());
      if (n !== giliran) return;
      if (!h) { tulis('Tidak dapat ambil kadar (tiada internet?). Taip sendiri, atau isi jumlah dicaj kad.'); return; }
      const k = denganMarkup(h.kadar);
      inp.value = k;
      inp.dataset.auto = String(k);
      inp.dataset.nota = notaPasaran(h);
      manual = false;
      tulis('US$1 = RM' + h.kadar + ' pada ' + tarikh(dariInput(h.tarikh)) + (data.markup ? ', + ' + data.markup + '% caj kad = RM' + k : '') +
        '. Kadar kad sebenar mungkin lebih tinggi sikit; untuk tepat, isi jumlah dicaj kad.');
      inp.dispatchEvent(new Event('input', { bubbles: true }));
    }
    inp.addEventListener('input', (e) => { if (e.isTrusted) { manual = true; delete inp.dataset.auto; tulis('Kadar ditaip sendiri. <button type="button" class="pautan" data-kadar-auto>Guna kadar pasaran</button>'); } });
    f.tBeli.addEventListener('change', () => ambil(false));
    f.mata.addEventListener('change', () => ambil(false));
    nota.addEventListener('click', (e) => { if (e.target.closest('[data-kadar-auto]')) ambil(true); });
    ambil(false);
  }

  // Nota sumber kadar bila order disimpan.
  function sumberKadar(f, kadar) {
    if (f.mata.value !== 'USD' || !kadar) return '';
    if (nomborAtauNull(f.caj.value)) return 'Dari caj kad RM' + bulat(f.caj.value);
    if (f.kadar.dataset.auto && Number(f.kadar.dataset.auto) === Number(kadar)) return f.kadar.dataset.nota || 'Pasaran';
    return 'Ditaip sendiri';
  }

  function medanKadar(o) {
    const mata = o ? o.mata : 'USD';
    return '<div class="dua"><label class="medan kecil">Mata wang<select name="mata"><option value="USD"' + (mata === 'USD' ? ' selected' : '') + '>USD</option>' +
      '<option value="RM"' + (mata === 'RM' ? ' selected' : '') + '>RM</option></select></label>' +
      '<label class="medan" data-kadar>Kadar (RM per US$)<input name="kadar" type="number" inputmode="decimal" min="0" step="0.0001" placeholder="contoh 4.25" value="' +
      esc(o ? (o.mata === 'USD' && o.kadar ? o.kadar : '') : '') + '"></label></div>' +
      '<p class="nota nota-kadar" data-kadar id="kadarNota"></p>' +
      '<label class="medan"><span data-label-ship>Shipping + tax order (US$)</span><input name="ship" type="number" inputmode="decimal" min="0" step="0.01" value="' + esc(o && o.ship ? o.ship : '') + '"></label>' +
      '<label class="medan" data-kadar>Atau: jumlah dicaj kad (RM) <small>(pilihan · app kira kadar sendiri)</small><input name="caj" type="number" inputmode="decimal" min="0" step="0.01"></label>';
  }

  function gunaMata(f) {
    const usd = f.mata.value === 'USD';
    f.querySelectorAll('[data-kadar]').forEach((el) => { el.hidden = !usd; });
    const s = usd ? 'US$' : 'RM';
    const ls = f.querySelector('[data-label-ship]');
    if (ls) ls.textContent = 'Shipping + tax order (' + s + ')';
    f.querySelectorAll('[data-label-beli-pendek]').forEach((el) => { el.textContent = s + ' seunit'; });
    f.querySelectorAll('[data-label-beli]').forEach((el) => { el.textContent = 'Harga beli seunit (' + s + ')'; });
  }

  // Kira kadar: dari jumlah dicaj kad kalau diisi.
  // Kadar USD->RM yang munasabah. Di luar julat ini hampir pasti tersalah isi
  // (contoh: jumlah RM ditaip dalam medan kadar, atau harga beli item belum diisi).
  function semakKadar(f, kadar, jumlahAsal) {
    if (f.mata.value !== 'USD' || kadar === null) return '';
    if (kadar >= 2 && kadar <= 10) return '';
    const caj = nomborAtauNull(f.caj.value);
    if (caj) {
      return 'Kadar dikira ' + kadar + ' (RM' + caj + ' ÷ US$' + bulat(jumlahAsal) + '), tidak munasabah. ' +
        'Pastikan harga beli semua item dan shipping telah diisi, atau kosongkan "jumlah dicaj kad" dan taip kadar terus (contoh 4.25).';
    }
    return 'Kadar ' + kadar + ' tidak munasabah. Kadar ialah berapa RM untuk US$1 (contoh 4.25), bukan jumlah RM.';
  }

  function kiraKadar(f, jumlahAsal) {
    if (f.mata.value === 'RM') return 1;
    const caj = nomborAtauNull(f.caj.value);
    if (caj && jumlahAsal > 0) return Math.round((caj / jumlahAsal) * 10000) / 10000;
    return nomborAtauNull(f.kadar.value) ? Number(f.kadar.value) : null;
  }

  // Tempahan kastemer: masuk dulu sebelum beli dari CM.
  function borangTempahan(awal) {
    isiDatalistOrang();
    borang({
      tajuk: 'Tempahan baru',
      nota: 'Barang yang ditempah pelanggan. Selepas membeli di CM, rekod Order CM dan tag item ini.',
      html: '<div id="barisOrder" data-tanpa-beli>' + htmlBarisOrder(awal || null, true) + '</div>' +
        '<button type="button" class="btn penuh-lebar" data-baris="tambah">+ Tambah item</button>',
      simpan: 'Simpan tempahan',
      hantar(f) {
        const baris = [...f.querySelectorAll('.baris-order')].map(bacaBaris).filter((x) => x.nama);
        if (!baris.length) return 'Isi sekurang-kurangnya satu item.';
        const tiada = baris.find((x) => !x.orang);
        if (tiada) return 'Isi pelanggan untuk ' + tiada.nama + ' (taip AKU untuk barang sendiri).';
        ubah(() => {
          baris.forEach((x, i) => {
            const aku = kunciOrang(x.orang) === AKU;
            const bayar = bulat(x.bayar);
            data.items.push(bersihItem({
              kat: aku ? 'aku' : 'jual', jenis: x.jenis, nama: x.nama, qty: x.qty, orang: x.orang, tel: aku ? '' : telUntuk(x.orang),
              harga: aku ? 0 : x.harga, gambar: x.gambar || gambarSama(x.jenis, x.nama), dibuat: Date.now(), urutan: Date.now() + i,
              bayaran: bayar && !aku ? [{ amaun: bayar, t: Date.now(), nota: 'Bayaran awal' }] : [],
            }));
          });
          tetapan.tab = 'beli'; simpanTetapan();
        }, baris.length + ' item tempahan disimpan.');
        return '';
      },
    });
  }

  // Order dari CM: isi butiran order, tag item tempahan, dan (pilihan) item lain yang tiada tempahan.
  function borangOrderBaru(tandaAwal) {
    isiDatalistOrang();
    const calon = calonTag(null);
    const set = new Set(tandaAwal || []);
    borang({
      tajuk: 'Order CM',
      html: '<div class="dua">' + medanTeks('kedai', 'Kedai', 'Mattel Creations', ' list="senaraiKedai" maxlength="40"') +
        medanTeks('akaun', 'Akaun', tetapan.akaun || '', ' list="senaraiAkaun" maxlength="40"') + '</div>' +
        '<div class="dua">' + medanTeks('no', 'No. order', '', ' maxlength="40" placeholder="CHP1234567" autocapitalize="characters" data-fokus') +
        medanTarikh('tBeli', 'Tarikh beli', Date.now(), true) + '</div>' +
        medanKadar(null) +
        '<h3>Tag item tempahan</h3><p class="nota">Tanda item yang dibeli dalam order ini dan isi harga beli seunit. Item sama nama diisi sendiri.</p>' +
        htmlTag(calon, null) +
        '<h3>Item lain <small>(tiada tempahan, contoh: barang sendiri)</small></h3><div id="barisOrder"></div>' +
        '<button type="button" class="btn penuh-lebar" data-baris="tambah">+ Tambah item lain</button>' +
        '<p class="nota" id="jumlahOrder"></p>',
      simpan: 'Simpan order',
      lepas: (f) => {
        f.querySelectorAll('.tag-baris input[name="tag"]').forEach((cb) => { if (set.has(cb.value)) cb.checked = true; });
        gunaMata(f); pasangTag(f); kiraJumlahOrder(f); pasangKadarAuto(f, false);
      },
      hantar(f) {
        const tag = bacaTag(f).filter((t) => t.pilih);
        const baris = [...f.querySelectorAll('.baris-order')].map(bacaBaris).filter((x) => x.nama);
        if (!tag.length && !baris.length) return 'Tag sekurang-kurangnya satu item, atau tambah item lain.';
        const tiada = baris.find((x) => !x.orang);
        if (tiada) return 'Isi pelanggan untuk ' + tiada.nama + ' (taip AKU untuk barang sendiri).';
        const asal = tag.reduce((j, t) => j + (Number(t.beli) || 0) * t.qty, 0) +
          baris.reduce((j, x) => j + (Number(x.beli) || 0) * (parseInt(x.qty, 10) || 1), 0) + (Number(f.ship.value) || 0);
        const kadar = kiraKadar(f, asal);
        const salah = semakKadar(f, kadar, asal);
        if (salah) return salah;
        const o = bersihOrder({
          id: idBaru(), kedai: f.kedai.value, no: f.no.value, akaun: f.akaun.value, tBeli: dariInput(f.tBeli.value),
          mata: f.mata.value, kadar, ship: f.ship.value, kadarNota: sumberKadar(f, kadar), dibuat: Date.now(),
        });
        ubah(() => {
          data.orders.push(o);
          tag.forEach((t) => { const it = cariItem(t.id); if (it) { it.orderId = o.id; it.beli = nomborAtauNull(t.beli); } });
          baris.forEach((x, i) => {
            const aku = kunciOrang(x.orang) === AKU;
            data.items.push(bersihItem({
              kat: aku ? 'aku' : 'jual', jenis: x.jenis, nama: x.nama, qty: x.qty, orang: x.orang, tel: aku ? '' : telUntuk(x.orang),
              harga: aku ? 0 : x.harga, beli: x.beli, gambar: x.gambar || gambarSama(x.jenis, x.nama), orderId: o.id, dibuat: Date.now(), urutan: Date.now() + i,
            }));
          });
          if (o.mata === 'USD' && o.kadar >= 2 && o.kadar <= 10) data.kadar = o.kadar;
          if (o.akaun) tetapan.akaun = o.akaun;
          simpanTetapan();
        }, 'Order ' + (o.no || '') + ' disimpan: ' + (tag.length + baris.length) + ' item.');
        return '';
      },
    });
  }

  // Ubah item dalam order sedia ada: tag / buang tag, dan harga beli.
  function borangTagOrder(o) {
    const calon = calonTag(o);
    borang({
      tajuk: 'Item dalam ' + (o.no || 'order'),
      nota: 'Tanda item dalam order ini dan isi harga beli seunit (' + mataSimbol(o.mata).trim() + '). Buang tanda untuk keluarkan item dari order.',
      html: htmlTag(calon, o) + '<p class="nota" id="jumlahOrder"></p>',
      lepas: (f) => {
        const s = o.mata === 'USD' ? 'US$ seunit' : 'RM seunit';
        f.querySelectorAll('[data-label-beli-pendek]').forEach((el) => { el.textContent = s; });
        pasangTag(f);
      },
      hantar(f) {
        const tag = bacaTag(f);
        ubah(() => {
          tag.forEach((t) => {
            const it = cariItem(t.id);
            if (!it) return;
            if (t.pilih) { it.orderId = o.id; it.beli = nomborAtauNull(t.beli); }
            else if (it.orderId === o.id) { it.orderId = null; it.beli = null; }
          });
        }, 'Item order dikemas kini.');
        return '';
      },
    });
  }

  /* ---------- Senarai order ---------- */

  function bukaSenaraiOrder() {
    panelLukis = paparSenaraiOrder;
    paparSenaraiOrder();
    buka($('dlgPanel'));
  }

  function paparSenaraiOrder() {
    const ords = data.orders.slice().sort((a, b) => b.tBeli - a.tBeli);
    let html = '<h2>Senarai order CM</h2>';
    if (!ords.length) html += '<p class="kosong">Belum ada order. Tekan + Order CM selepas membeli.</p>';
    html += ords.map((o) => {
      const its = itemOrder(o);
      const asal = its.reduce((j, it) => j + (beliAsal(it) || 0), 0) + (o.ship || 0);
      const kira = {};
      its.forEach((it) => { const t = it.arkib ? 'Selesai' : TAB[tabItem(it)]; kira[t] = (kira[t] || 0) + 1; });
      return '<button type="button" class="orang-baris" data-order="' + esc(o.id) + '"><span class="isi"><b>' + esc(o.no || 'Tanpa no.') + '</b><small>' +
        esc(o.kedai) + ' · ' + tarikh(o.tBeli) + (o.akaun ? ' · ' + esc(o.akaun) : '') + '<br>' + its.length + ' item' +
        (its.length ? ': ' + Object.entries(kira).map(([k, n]) => n + ' ' + k).join(', ') : '') + '</small></span>' +
        '<span class="baki sifar">' + (o.mata === 'USD' ? 'US$' + bulat(asal) : rm(asal)) + (o.kadar && o.mata === 'USD' ? '<small>' + rm(asal * o.kadar) + '</small>' : '') + '</span></button>';
    }).join('');
    html += '<div class="aksi-bawah"><button class="btn" type="button" data-tutup="1">Tutup</button></div>';
    $('panelIsi').innerHTML = html;
  }

  function kiraJumlahOrder(f) {
    const el = f.querySelector('#jumlahOrder');
    if (!el) return;
    const baris = [...f.querySelectorAll('.baris-order')].map(bacaBaris).filter((b) => b.nama);
    const tag = bacaTag(f).filter((t) => t.pilih);
    if (!f.mata) { el.textContent = tag.length + ' item ditanda.'; return; }
    const s = f.mata.value === 'USD' ? 'US$' : 'RM';
    const beli = baris.reduce((j, b) => j + (Number(b.beli) || 0) * (parseInt(b.qty, 10) || 1), 0) +
      tag.reduce((j, t) => j + (Number(t.beli) || 0) * t.qty, 0);
    const jual = baris.reduce((j, b) => j + (kunciOrang(b.orang) === AKU ? 0 : Number(b.harga) || 0), 0) +
      tag.reduce((j, t) => { const it = cariItem(t.id); return j + (it && it.kat === 'jual' ? it.harga : 0); }, 0);
    const tanpaHarga = tag.filter((t) => t.beli === '').length;
    const ship = Number(f.ship.value) || 0;
    const kadar = kiraKadar(f, beli + ship);
    let t = (baris.length + tag.length) + ' item · beli ' + wang(beli, s) + (ship ? ' + shipping ' + wang(ship, s) : '');
    if (kadar && f.mata.value === 'USD') t += ' = ' + rm((beli + ship) * kadar) + ' (US$1 = RM' + kadar + ')';
    const amaran = semakKadar(f, kadar, beli + ship);
    if (amaran) t += '. ⚠ ' + amaran;
    if (jual) t += ' · jual ' + rm(jual);
    if (tanpaHarga) t += ' · ' + tanpaHarga + ' item belum ada harga beli';
    el.textContent = t;
  }

  $('formX').addEventListener('click', (e) => {
    const b = e.target.closest('[data-baris]');
    if (!b) return;
    const f = $('formX');
    const bekas = f.querySelector('#barisOrder');
    if (!bekas) return;
    const tanpaBeli = bekas.hasAttribute('data-tanpa-beli');
    if (b.dataset.baris === 'tambah') {
      bekas.insertAdjacentHTML('beforeend', htmlBarisOrder(tanpaBeli ? null : { orang: AKU }, tanpaBeli));
      bekas.lastElementChild.querySelector('[name="nama"]').focus();
    } else if (b.dataset.baris === 'salin') {
      const baris = b.closest('.baris-order');
      const n = bacaBaris(baris);
      n.orang = '';
      baris.insertAdjacentHTML('afterend', htmlBarisOrder(n, tanpaBeli));
      baris.nextElementSibling.querySelector('[name="orang"]').focus();
    } else if (b.dataset.baris === 'buang') {
      if (bekas.children.length > 1 || !tanpaBeli) b.closest('.baris-order').remove();
      else bekas.innerHTML = htmlBarisOrder(null, true);
    }
    if (f.mata) gunaMata(f);
    kiraJumlahOrder(f);
  });
  $('formX').addEventListener('input', (e) => {
    const f = $('formX');
    if (e.target.name === 'mata') gunaMata(f);
    if (f.querySelector('#jumlahOrder') && !e.target.matches('[data-tapis-pilih]')) kiraJumlahOrder(f);
  });
  $('formX').addEventListener('change', (e) => {
    if (e.target.name === 'mata') { gunaMata($('formX')); kiraJumlahOrder($('formX')); }
  });

  /* ---------- Order: butiran dan edit ---------- */

  let orderId = null;
  function bukaOrder(id) {
    orderId = id;
    if (paparOrder()) buka($('dlgOrder'));
  }

  function paparOrder() {
    const o = cariOrder(orderId);
    if (!o) { tutup($('dlgOrder')); return false; }
    const its = itemOrder(o).sort(urut);
    const s = mataSimbol(o.mata);
    const asal = its.reduce((j, it) => j + (beliAsal(it) || 0), 0);
    const tiadaBeli = its.filter((it) => it.beli === null).length;

    let html = '<div class="butir-kepala"><h2>' + esc(o.no || 'Tanpa no. order') + '</h2></div>';
    html += '<p class="butir-sub">' + esc(o.kedai) + (o.akaun ? ' · ' + esc(o.akaun) : '') + ' · dibeli ' + tarikh(o.tBeli) + '</p>';

    html += '<table class="jadual"><thead><tr><th>Item</th><th>Beli</th><th>Kos RM</th></tr></thead><tbody>' +
      its.map((it) => {
        const k = kosItem(it);
        return '<tr data-item="' + esc(it.id) + '"><td><b>' + esc(labelItem(it)) + '</b><small>' + esc(it.kat === 'aku' ? 'Sendiri' : it.orang) + ' · ' + esc(PERINGKAT[peringkat(it)]) + '</small></td>' +
          '<td>' + (it.beli === null ? '<span class="tag-amaran">?</span>' : wang(beliAsal(it), s)) + '</td>' +
          '<td>' + (k.barang === null ? '-' : rm(k.barang + k.shipCM)) + '</td></tr>';
      }).join('') + '</tbody></table>';
    html += '<div class="ringkas-kos">' +
      '<div><span>Harga barang</span><b>' + wang(asal, s) + '</b></div>' +
      '<div><span>Shipping + tax</span><b>' + wang(o.ship, s) + '</b></div>' +
      '<div><span>Jumlah</span><b>' + wang(asal + o.ship, s) + (o.mata === 'USD' && o.kadar ? ' = ' + rm((asal + o.ship) * o.kadar) : '') + '</b></div>' +
      (o.mata === 'USD' ? '<div><span>Kadar' + (o.kadarNota ? ' · ' + esc(o.kadarNota) : '') + '</span><b>' + (o.kadar ? 'US$1 = RM' + o.kadar + (o.kadar < 2 || o.kadar > 10 ? ' <span class="tag-amaran">Salah?</span>' : '') : '<span class="tag-amaran">Belum diisi</span>') + '</b></div>' : '') +
      '</div>';
    if (o.mata === 'USD') html += '<button type="button" class="btn kecil" data-aksi="kadarAuto" style="margin-bottom:10px">Guna kadar pasaran ' + tarikh(o.tBeli) + '</button>';
    if (tiadaBeli) html += '<p class="nota">' + tiadaBeli + ' item belum ada harga beli. Tekan Tag / ubah item untuk isi.</p>';
    html += '<p class="nota">Shipping dibahagi ikut harga beli setiap item.</p>';
    if (o.catatan) html += '<div class="catatan-penuh">' + esc(o.catatan) + '</div>';

    const belum = its.filter((it) => peringkat(it) === 'beli');
    html += '<div class="grid-aksi">' +
      (belum.length ? '<button class="btn utama penuh" type="button" data-aksi="declare">Declare ke hub (' + belum.length + ' item)</button>' : '') +
      '<button class="btn" type="button" data-aksi="tag">Tag / ubah item</button>' +
      '<button class="btn" type="button" data-aksi="edit">Edit order</button>' +
      '<button class="btn bahaya penuh" type="button" data-aksi="padam">Padam order</button></div>';
    html += '<div class="aksi-bawah"><button class="btn" type="button" data-aksi="tutup">Tutup</button></div>';
    $('orderIsi').innerHTML = html;
    return true;
  }

  $('orderIsi').addEventListener('click', async (e) => {
    const tr = e.target.closest('[data-item]');
    if (tr) { bukaButir(tr.dataset.item); return; }
    const b = e.target.closest('[data-aksi]');
    if (!b) return;
    const o = cariOrder(orderId);
    if (!o) return;
    const a = b.dataset.aksi;
    if (a === 'tutup') tutup($('dlgOrder'));
    else if (a === 'declare') borangDeclare(itemOrder(o).filter((it) => peringkat(it) === 'beli').map((it) => it.id));
    else if (a === 'tag') borangTagOrder(o);
    else if (a === 'edit') borangOrder(o);
    else if (a === 'kadarAuto') {
      b.disabled = true;
      b.textContent = 'Mengambil kadar…';
      const h = await kadarPasaran(tarikhInput(o.tBeli));
      if (!h) { toast('Tidak dapat ambil kadar. Semak internet.'); paparOrder(); return; }
      const k = denganMarkup(h.kadar);
      ubah(() => { o.kadar = k; o.kadarNota = notaPasaran(h); }, 'Kadar US$1 = RM' + k + ' (' + tarikh(dariInput(h.tarikh)) + ').');
    }
    else if (a === 'padam') {
      const ok = await sahkan({ tajuk: 'Padam order ' + (o.no || '') + '?', teks: 'Item dalam order ini tidak dipadam. Ia cuma tidak lagi ada harga beli dari order ini.', ya: 'Padam', bahaya: true });
      if (!ok) return;
      ubah(() => { data.orders = data.orders.filter((x) => x !== o); }, 'Order dipadam.');
      tutup($('dlgOrder'));
    }
  });

  function borangOrder(o) {
    borang({
      tajuk: 'Edit order',
      html: '<div class="dua">' + medanTeks('kedai', 'Kedai', o.kedai, ' list="senaraiKedai" maxlength="40"') +
        medanTeks('akaun', 'Akaun', o.akaun, ' list="senaraiAkaun" maxlength="40"') + '</div>' +
        '<div class="dua">' + medanTeks('no', 'No. order', o.no, ' maxlength="40"') + medanTarikh('tBeli', 'Tarikh beli', o.tBeli, true) + '</div>' +
        medanKadar(o) +
        '<label class="medan">Catatan <small>(pilihan)</small><textarea name="catatan" rows="2" maxlength="300">' + esc(o.catatan) + '</textarea></label>' +
        '<p class="nota" id="jumlahEdit"></p><p class="nota">Item dan harga beli diubah melalui Tag / ubah item.</p>',
      lepas: (f) => {
        gunaMata(f);
        const asal = itemOrder(o).reduce((j, it) => j + (beliAsal(it) || 0), 0);
        const segar = () => {
          const ship = Number(f.ship.value) || 0;
          const kadar = kiraKadar(f, asal + ship);
          f.querySelector('#jumlahEdit').textContent = f.mata.value !== 'USD' ? '' :
            'US$' + bulat(asal + ship) + (kadar ? ' = ' + rm((asal + ship) * kadar) + ' (US$1 = RM' + kadar + ')' : '') +
            (semakKadar(f, kadar, asal + ship) ? '. ⚠ ' + semakKadar(f, kadar, asal + ship) : '');
        };
        f.querySelectorAll('input, select').forEach((el) => el.addEventListener('input', segar));
        segar();
        const salah = o.mata === 'USD' && (!o.kadar || o.kadar < 2 || o.kadar > 10);
        pasangKadarAuto(f, !salah);
      },
      hantar(f) {
        const asal = itemOrder(o).reduce((j, it) => j + (beliAsal(it) || 0), 0) + (Number(f.ship.value) || 0);
        const kadar = kiraKadar(f, asal);
        const salah = semakKadar(f, kadar, asal);
        if (salah) return salah;
        ubah(() => {
          Object.assign(o, bersihOrder(Object.assign({}, o, {
            kedai: f.kedai.value, akaun: f.akaun.value, no: f.no.value, tBeli: dariInput(f.tBeli.value),
            mata: f.mata.value, kadar, ship: f.ship.value, catatan: f.catatan.value.trim(),
            kadarNota: Number(kadar) === Number(o.kadar) && !nomborAtauNull(f.caj.value) && !f.kadar.dataset.auto ? o.kadarNota : sumberKadar(f, kadar),
          })));
          if (o.mata === 'USD' && o.kadar >= 2 && o.kadar <= 10) data.kadar = o.kadar;
        }, 'Order disimpan.');
        return '';
      },
    });
  }

  /* ---------- Declare parcel ke hub ---------- */

  function borangDeclare(tanda, utamaOrder) {
    const calon = itemTab('beli').sort((a, b) => ((b.orderId === utamaOrder) - (a.orderId === utamaOrder)) || urut(a, b));
    if (!calon.length) { toast('Tiada item yang belum ship.'); return; }
    borang({
      tajuk: 'Declare parcel ke hub',
      nota: 'Tanda item yang ship dalam satu parcel. No. order yang sama boleh di-declare lebih dari sekali.',
      html: '<div class="dua">' + medanTarikh('t', 'Tarikh ship', Date.now(), true) +
        medanTeks('track', 'Tracking US <small>(pilihan)</small>', '', ' maxlength="60" placeholder="FedEx / USPS" data-fokus') + '</div>' +
        '<label class="tanda"><input type="checkbox" name="declare" checked> Telah declare di Buyandship</label>' +
        senaraiPilih('item', pilihanItem(calon, tanda)),
      simpan: 'Declare',
      hantar(f) {
        const ids = nilaiPilih(f, 'item');
        if (!ids.length) return 'Tanda sekurang-kurangnya satu item.';
        const t = dariInput(f.t.value);
        const trk = f.track.value.trim();
        const dec = f.declare.checked;
        ubah(() => {
          ids.forEach((id) => {
            const it = cariItem(id);
            if (!it) return;
            it.tShip = t; it.trackUS = trk;
            it.tDeclare = dec ? t : null;
          });
        }, ids.length + ' item dalam perjalanan ke gudang BNS.');
        return '';
      },
    });
  }

  // Pulangkan item ke Belum Ship (contoh: tersilap declare, atau data lama yang sebenarnya belum ship).
  function undurKeBeli(it) {
    it.tShip = null; it.trackUS = ''; it.tDeclare = null; it.tHub = null; it.tKeHK = null; it.tHK = null; it.kotakId = null; it.hantarId = null; it.lama = false;
  }

  // Undur satu peringkat sahaja (untuk betulkan tekan tersilap), tanpa pengesahan.
  function undurSatu(it) {
    const p = peringkat(it);
    if (p === 'hantar') it.hantarId = null;
    else if (p === 'kotak' || p === 'post' || p === 'sampai') it.kotakId = null;
    else if (p === 'hk') it.tHK = null;
    else if (p === 'keHK') it.tKeHK = null;
    else if (p === 'hub') it.tHub = null;
    else if (p === 'ship') undurKeBeli(it);
    return peringkat(it);
  }

  function borangUndur(ids) {
    const calon = ids.map(cariItem).filter(Boolean);
    borang({
      tajuk: 'Pulangkan ke Tempahan',
      nota: 'Tanda item yang sebenarnya belum ship. Tracking dan tarikh ship item itu akan dikosongkan.',
      html: senaraiPilih('item', pilihanItem(calon, [])),
      simpan: 'Pulangkan',
      hantar(f) {
        const pilih = nilaiPilih(f, 'item');
        if (!pilih.length) return 'Tanda sekurang-kurangnya satu item.';
        ubah(() => { pilih.forEach((id) => { const it = cariItem(id); if (it) undurKeBeli(it); }); }, pilih.length + ' item kembali ke Tempahan.');
        return '';
      },
    });
  }

  function tandaHub(ids) {
    tandaMasa(ids, 'tHub', 'tiba di gudang.');
  }

  // Tanda satu peringkat pada beberapa item; peringkat sebelumnya yang kosong diisi sekali.
  function tandaMasa(ids, kunci, mesej, masa) {
    const urutan = ['tShip', 'tHub', 'tKeHK', 'tHK'];
    const hingga = urutan.indexOf(kunci);
    const kini = masa || Date.now();
    ubah(() => {
      ids.forEach((id) => {
        const it = cariItem(id);
        if (!it) return;
        urutan.slice(0, hingga + 1).forEach((k) => { if (!it[k]) it[k] = kini; });
      });
    }, ids.length + ' item ' + mesej);
  }

  // Pilih item mana yang naik peringkat (parcel dalam satu kumpulan mungkin berbeza).
  // Item dalam satu parcel (tracking sama) bergerak bersama. Pilih parcel mana yang naik peringkat.
  function parcelDari(its) {
    const peta = new Map();
    its.forEach((it) => {
      const k = it.trackUS ? 'T:' + it.trackUS : 'I:' + it.id;
      if (!peta.has(k)) peta.set(k, []);
      peta.get(k).push(it);
    });
    return [...peta.values()];
  }

  // Item lain dalam parcel yang sama dan di peringkat yang sama.
  function sekumpulan(it) {
    if (!it.trackUS) return [it.id];
    const p = peringkat(it);
    return data.items.filter((x) => x.trackUS === it.trackUS && peringkat(x) === p).map((x) => x.id);
  }

  function borangTanda(ids, kunci, tajuk, mesej) {
    const parcel = parcelDari(ids.map(cariItem).filter(Boolean).sort(urut));
    const pilihan = parcel.map((its) => ({
      nilai: its.map((it) => it.id).join(','),
      label: its[0].trackUS ? 'Tracking ' + its[0].trackUS : labelItem(its[0]) + ' · tanpa tracking',
      sub: its.map((it) => labelItem(it) + ' (' + (it.kat === 'aku' ? 'Sendiri' : it.orang) + ')').join(', '),
      pilih: parcel.length === 1,
    }));
    borang({
      tajuk,
      nota: 'Item dengan tracking yang sama bergerak bersama. Tanda parcel yang berkenaan sahaja.',
      html: medanTarikh('t', 'Tarikh', Date.now(), true) + senaraiPilih('parcel', pilihan),
      simpan: 'Simpan',
      hantar(f) {
        const pilih = nilaiPilih(f, 'parcel').join(',').split(',').filter(Boolean);
        if (!pilih.length) return 'Tanda sekurang-kurangnya satu parcel.';
        tandaMasa(pilih, kunci, mesej, dariInput(f.t.value));
        return '';
      },
    });
  }

  /* ---------- Kotak (consolidate BNS) ---------- */

  function borangKotak(k, tanda) {
    const susun = { hk: 0, keHK: 1, hub: 2, ship: 3 };
    const calon = data.items.filter((it) => (k && it.kotakId === k.id) || ['ship', 'hub', 'keHK', 'hk'].includes(peringkat(it)))
      .sort((a, b) => ((susun[peringkat(a)] || 0) - (susun[peringkat(b)] || 0)) || urut(a, b));
    const set = new Set(tanda || []);
    if (k) itemKotak(k).forEach((it) => set.add(it.id));
    if (!calon.length) { toast('Tiada item dalam perjalanan ke BNS.'); return; }
    let html = '<div class="dua">' + medanTeks('no', 'Nama / no. BNS <small>(pilihan)</small>', k ? k.no : '', ' maxlength="40"') +
      medanTarikh('tBuat', 'Tarikh consolidate', k ? k.tBuat : Date.now(), true) + '</div>' +
      medanNombor('kos', 'Kos posting BNS (RM)', k && k.kos !== null ? k.kos : '', ' data-fokus');
    if (k) {
      html += '<div class="dua">' + medanTeks('trackMY', 'Tracking Skynet', k.trackMY, ' maxlength="60"') + medanTarikh('tPost', 'Tarikh post', k.tPost) + '</div>' +
        medanTarikh('tSampai', 'Tarikh sampai MY', k.tSampai);
    }
    html += '<h3>Item dalam kotak</h3>' + senaraiPilih('item', calon.map((it) => {
      const p = pilihanItem([it], [...set])[0];
      p.sub = PERINGKAT[peringkat(it)] + ' · ' + p.sub;
      return p;
    }));
    borang({
      tajuk: k ? 'Edit kotak' : 'Consolidate kotak baru',
      nota: 'Kos posting dibahagi kepada item ikut kos barang + shipping CM.',
      html,
      hantar(f) {
        const ids = nilaiPilih(f, 'item');
        if (!ids.length) return 'Tanda sekurang-kurangnya satu item.';
        const nilai = { no: f.no.value, tBuat: dariInput(f.tBuat.value), kos: f.kos.value };
        if (k) {
          Object.assign(nilai, { trackMY: f.trackMY.value, tPost: tarikhAtauNull(f.tPost.value), tSampai: tarikhAtauNull(f.tSampai.value) });
          if (nilai.tSampai && !nilai.tPost) return 'Isi tarikh post dulu sebelum tarikh sampai.';
        }
        ubah(() => {
          let kk = k;
          if (kk) Object.assign(kk, bersihKotak(Object.assign({}, kk, nilai)));
          else { kk = bersihKotak(Object.assign(nilai, { id: idBaru(), dibuat: Date.now() })); data.kotak.push(kk); }
          data.items.forEach((it) => {
            if (it.kotakId === kk.id && !ids.includes(it.id) && !it.hantarId) it.kotakId = null;
          });
          ids.forEach((id) => {
            const it = cariItem(id);
            if (!it) return;
            it.kotakId = kk.id;
            if (!it.tShip) it.tShip = kk.tBuat;
            ['tHub', 'tKeHK', 'tHK'].forEach((x) => { if (!it[x]) it[x] = kk.tBuat; });
          });
          tetapan.tab = 'otw'; simpanTetapan();
        }, k ? 'Kotak disimpan.' : 'Kotak dibuat dengan ' + ids.length + ' item.');
        return '';
      },
    });
  }

  function borangSkynet(k) {
    if (!k) return;
    borang({
      tajuk: 'Tracking Skynet',
      nota: esc(namaKotak(k)) + ' · ' + itemKotak(k).length + ' item',
      html: medanTeks('track', 'Tracking Skynet', k.trackMY, ' maxlength="60" data-fokus') + medanTarikh('t', 'Tarikh post', k.tPost || Date.now(), true) +
        (k.kos === null ? medanNombor('kos', 'Kos posting BNS (RM)', '') : ''),
      hantar(f) {
        ubah(() => {
          k.trackMY = f.track.value.trim().slice(0, 60);
          k.tPost = dariInput(f.t.value);
          if (f.kos && f.kos.value !== '') k.kos = nomborAtauNull(f.kos.value);
        }, namaKotak(k) + ' dipost ke MY.');
        return '';
      },
    });
  }

  function borangSampai(k) {
    if (!k) return;
    borang({
      tajuk: 'Kotak tiba di Malaysia',
      nota: esc(namaKotak(k)) + ' · item akan dipindah ke tab Tiba untuk diasingkan.',
      html: medanTarikh('t', 'Tarikh sampai', Date.now(), true),
      hantar(f) {
        ubah(() => { k.tSampai = dariInput(f.t.value); if (!k.tPost) k.tPost = k.tSampai; }, namaKotak(k) + ' sampai. ' + itemKotak(k).length + ' item dalam tab Tiba.');
        return '';
      },
    });
  }

  let kotakId = null;
  function bukaKotak(id) {
    kotakId = id;
    if (paparKotak()) buka($('dlgKotak'));
  }

  /* ---------- Pautan tracking syarikat penghantaran ---------- */

  // US: FedEx atau USPS, dikenal pasti dari bentuk nombor. Skynet dan J&T: laman tracking
  // mereka tidak terima nombor dalam pautan, jadi nombor disalin dulu untuk ditampal.
  function kurierUS(no) {
    const n = String(no || '').replace(/\s/g, '');
    if (/^(fdx|fedex)/i.test(n)) return 'fedex';
    if (/^(usps)/i.test(n)) return 'usps';
    const d = n.replace(/\D/g, '');
    if (/^9[1-5]\d{18,26}$/.test(d) || /^[A-Z]{2}\d{9}US$/i.test(n)) return 'usps';
    if (/^\d{12}$|^\d{15}$|^\d{20}$|^\d{22}$/.test(d)) return 'fedex';
    return null;
  }

  function urlJejak(no, jenis) {
    const n = String(no || '').trim().replace(/^(fdx|fedex|usps)\s*:?\s*/i, '');
    const e = encodeURIComponent(n.replace(/\s/g, ''));
    if (jenis === 'us') jenis = kurierUS(no) || 'fedex';
    return {
      fedex: { url: 'https://www.fedex.com/fedextrack/?trknbr=' + e, nama: 'FedEx', salin: false },
      usps: { url: 'https://tools.usps.com/go/TrackConfirmAction?tLabels=' + e, nama: 'USPS', salin: false },
      skynet: { url: 'https://www.skynet.com.my/track', nama: 'Skynet', salin: true },
      jnt: { url: 'https://www.jtexpress.my/tracking', nama: 'J&T', salin: true },
    }[jenis];
  }

  function htmlJejak(no, jenis) {
    if (!no) return '';
    if (jenis === 'us' && !kurierUS(no)) return htmlJejak(no, 'fedex') + ' · ' + htmlJejak(no, 'usps');
    const j = urlJejak(no, jenis);
    return '<a class="jejak" href="' + esc(j.url) + '" target="_blank" rel="noopener" data-jejak-salin="' + (j.salin ? esc(no) : '') + '" data-kurier="' + esc(j.nama) + '">' +
      'Jejak ' + esc(j.nama) + ' ↗</a>';
  }

  // Nombor tracking sebagai pautan, dengan butang salin di sebelah.
  function htmlNoJejak(no, jenis) {
    const pautan = jenis === 'us' && !kurierUS(no) ? [urlJejak(no, 'fedex'), urlJejak(no, 'usps')] : [urlJejak(no, jenis)];
    return pautan.map((j, i) => '<a class="no-jejak" href="' + esc(j.url) + '" target="_blank" rel="noopener" data-jejak-salin="' + (j.salin ? esc(no) : '') +
      '" data-kurier="' + esc(j.nama) + '">' + (i === 0 ? esc(j.nama) + ' ' + esc(no) : esc(j.nama)) + ' ↗</a>').join(' · ') +
      '<button type="button" class="buang" data-salin="' + esc(no) + '" aria-label="Salin ' + esc(no) + '">' + IKON_SALIN + '</button>';
  }

  document.addEventListener('click', (e) => {
    const a = e.target.closest('a[data-jejak-salin]');
    if (!a || !a.dataset.jejakSalin) return;
    const no = a.dataset.jejakSalin;
    try { navigator.clipboard.writeText(no); } catch (err) { /* tak penting */ }
    toast('Nombor ' + no + ' disalin. Tampal di laman ' + a.dataset.kurier + '.');
  });

  // opt.tempoh: tunjuk berapa hari di setiap peringkat (hingga peringkat seterusnya, atau hari ini).
  function garisMasa(baris, opt) {
    if (opt && opt.tempoh) {
      const ada = baris.map((b, i) => (b.t ? i : -1)).filter((i) => i >= 0);
      ada.forEach((i, n) => {
        const seterusnya = ada[n + 1];
        if (seterusnya !== undefined) baris[i].hari = bilHari(baris[i].t, baris[seterusnya].t);
        else if (!opt.selesai) { baris[i].hari = bilHari(baris[i].t); baris[i].kini = true; }
      });
      const maks = Math.max(0, ...baris.map((b) => b.hari || 0));
      if (maks > 0) baris.forEach((b) => { if (b.hari === maks) b.lama = true; });
    }
    return '<ol class="garis-masa">' + baris.map((b) =>
      '<li class="' + (b.t ? 'siap' : '') + '"><span class="bulatan"></span><span class="isi"><b>' + esc(b.label) + '</b>' +
      '<small>' + (b.t ? tarikh(b.t) : (b.kosong || 'Belum')) + (b.sub ? ' · ' + b.sub : '') + '</small>' +
      (b.jejak && b.salin ? htmlJejak(b.salin, b.jejak) : '') + '</span>' +
      (b.salin ? '<button type="button" class="buang" data-salin="' + esc(b.salin) + '" aria-label="Salin ' + esc(b.salin) + '">' + IKON_SALIN + '</button>' : '') +
      (b.hari !== undefined ? '<span class="gm-hari' + (b.lama ? ' lama' : '') + '">' + teksHari(b.hari) + (b.kini ? ' · kini' : '') + '</span>' : '') +
      '</li>').join('') + '</ol>';
  }

  function paparKotak() {
    const k = cariKotak(kotakId);
    if (!k) { tutup($('dlgKotak')); return false; }
    const its = itemKotak(k);
    let html = '<div class="butir-kepala"><h2>' + esc(namaKotak(k)) + '</h2><span class="pil-tahap t-' + tahapKotak(k) + '">' + esc(labelKotak(k)) + '</span></div>';
    html += '<p class="butir-sub">' + its.length + ' item · kos posting ' + (k.kos === null ? '<span class="tag-amaran">belum diisi</span>' : rm(k.kos)) + '</p>';
    html += '<div class="grid-aksi">' +
      (!k.tPost ? '<button class="btn utama penuh" type="button" data-aksi="skynet">Isi tracking Skynet</button>'
        : !k.tSampai ? '<button class="btn hijau penuh" type="button" data-aksi="sampai">Tiba di Malaysia</button>' : '') + '</div>';
    html += garisMasa([
      { label: 'Consolidate', t: k.tBuat, sub: k.kos !== null ? 'kos ' + rm(k.kos) : '' },
      { label: 'Dipost ke MY', t: k.tPost, sub: k.trackMY ? 'Skynet ' + esc(k.trackMY) : '', salin: k.trackMY, jejak: 'skynet' },
      { label: 'Tiba di Malaysia', t: k.tSampai, sub: k.tSampai && k.tPost ? bilHari(k.tPost, k.tSampai) + ' hari perjalanan' : '' },
    ]);
    html += '<h3>Item (' + its.length + ')</h3><table class="jadual"><thead><tr><th>Item</th><th>Posting</th></tr></thead><tbody>' +
      its.map((it) => '<tr data-item="' + esc(it.id) + '"><td><b>' + esc(labelItem(it)) + '</b><small>' + esc(it.kat === 'aku' ? 'Sendiri' : it.orang) + '</small></td><td>' +
        (k.kos ? rm(kosItem(it).bns) : '-') + '</td></tr>').join('') + '</tbody></table>';
    html += '<div class="grid-aksi" style="margin-top:12px"><button class="btn" type="button" data-aksi="edit">Edit / urus item</button>' +
      '<button class="btn bahaya" type="button" data-aksi="padam">Padam kotak</button></div>';
    html += '<div class="aksi-bawah"><button class="btn" type="button" data-aksi="tutup">Tutup</button></div>';
    $('kotakIsi').innerHTML = html;
    return true;
  }

  $('kotakIsi').addEventListener('click', async (e) => {
    const sal = e.target.closest('[data-salin]');
    if (sal) { salin(sal.dataset.salin); return; }
    const tr = e.target.closest('[data-item]');
    if (tr) { bukaButir(tr.dataset.item); return; }
    const b = e.target.closest('[data-aksi]');
    if (!b) return;
    const k = cariKotak(kotakId);
    if (!k) return;
    const a = b.dataset.aksi;
    if (a === 'tutup') tutup($('dlgKotak'));
    else if (a === 'skynet') borangSkynet(k);
    else if (a === 'sampai') borangSampai(k);
    else if (a === 'edit') borangKotak(k);
    else if (a === 'padam') {
      const ok = await sahkan({ tajuk: 'Padam ' + namaKotak(k) + '?', teks: 'Item tidak dipadam; ia kembali ke "Hub".', ya: 'Padam', bahaya: true });
      if (!ok) return;
      ubah(() => { data.kotak = data.kotak.filter((x) => x !== k); }, 'Kotak dipadam.');
      tutup($('dlgKotak'));
    }
  });

  /* ---------- Serah pada kastemer ---------- */

  // Satu hantaran boleh ada beberapa pelanggan yang guna alamat sama (satu tracking J&T).
  function borangSerah(kunci, tanda) {
    const semua = itemTab('sampai').filter((it) => it.kat === 'jual');
    const calon = semua.filter((it) => kunciOrang(it.orang) === kunci);
    if (!calon.length) { toast('Tiada item yang telah tiba untuk pelanggan ini.'); return; }
    const lain = semua.filter((it) => kunciOrang(it.orang) !== kunci).sort((a, b) => a.orang.localeCompare(b.orang) || urut(a, b));
    const nama = calon[0].orang;
    const pilih = tanda && tanda.length ? tanda : calon.map((it) => it.id);
    borang({
      tajuk: 'Penghantaran kepada ' + nama,
      html: '<fieldset class="pilih-kat dua-pilih"><legend>Cara</legend>' +
        '<label><input type="radio" name="cara" value="pos" checked><span>Post J&amp;T</span></label>' +
        '<label><input type="radio" name="cara" value="sendiri"><span>Hantar sendiri</span></label></fieldset>' +
        '<div data-pos><div class="dua">' + medanTeks('track', 'Tracking J&amp;T', '', ' maxlength="60" data-fokus') +
        medanNombor('kos', 'Kos J&amp;T (RM) <small>(ditanggung sendiri)</small>', '') + '</div>' + butangImbas('track') + '</div>' +
        medanTarikh('t', 'Tarikh', Date.now(), true) +
        '<h3>Item ' + esc(nama) + '</h3>' + senaraiPilih('item', pilihanItem(calon, pilih)) +
        (lain.length ? '<h3>Pelanggan lain, alamat sama? <small>(pilihan)</small></h3><p class="nota">Tanda item pelanggan lain yang dihantar dalam bungkusan yang sama.</p>' +
          senaraiPilih('item', pilihanItem(lain, [])) : ''),
      simpan: 'Simpan',
      lepas: (f) => {
        const segar = () => { f.querySelector('[data-pos]').hidden = f.cara.value !== 'pos'; };
        f.querySelectorAll('[name="cara"]').forEach((r) => r.addEventListener('change', segar));
        segar();
      },
      hantar(f) {
        const ids = nilaiPilih(f, 'item');
        if (!ids.length) return 'Tanda sekurang-kurangnya satu item.';
        const nama2 = [...new Set(ids.map((id) => cariItem(id)).filter(Boolean).map((it) => it.orang))];
        nama2.sort((a, b) => (kunciOrang(b) === kunci) - (kunciOrang(a) === kunci));
        const pos = f.cara.value === 'pos';
        const h = bersihHantar({
          id: idBaru(), orang: nama2.join(' + '), cara: f.cara.value, track: pos ? f.track.value : '', kos: pos ? f.kos.value : null,
          t: dariInput(f.t.value), dibuat: Date.now(),
        });
        ubah(() => {
          data.hantar.push(h);
          ids.forEach((id) => { const it = cariItem(id); if (it) it.hantarId = h.id; });
        });
        toast(ids.length + ' item ' + (pos ? 'dipost' : 'dihantar') + ' pada ' + h.orang + '.', { label: 'WhatsApp', fn: () => waHantar(cariHantar(h.id)) });
        return '';
      },
    });
  }

  function borangHantar(h) {
    if (!h) return;
    borang({
      tajuk: 'Hantaran ' + h.orang,
      html: '<fieldset class="pilih-kat dua-pilih"><legend>Cara</legend>' +
        '<label><input type="radio" name="cara" value="pos"' + (h.cara === 'pos' ? ' checked' : '') + '><span>Post J&amp;T</span></label>' +
        '<label><input type="radio" name="cara" value="sendiri"' + (h.cara === 'sendiri' ? ' checked' : '') + '><span>Hantar sendiri</span></label></fieldset>' +
        '<div class="dua">' + medanTeks('track', 'Tracking J&amp;T', h.track, ' maxlength="60"') + medanNombor('kos', 'Kos J&amp;T (RM)', h.kos === null ? '' : h.kos) + '</div>' +
        butangImbas('track') +
        medanTarikh('t', 'Tarikh', h.t, true) +
        '<label class="tanda"><input type="checkbox" name="batal"> Batalkan hantaran ini (item kembali ke Tiba)</label>',
      hantar(f) {
        if (f.batal.checked) {
          ubah(() => { itemHantar(h).forEach((it) => { it.hantarId = null; it.arkib = null; }); }, 'Hantaran dibatalkan.');
          return '';
        }
        ubah(() => {
          Object.assign(h, bersihHantar(Object.assign({}, h, { cara: f.cara.value, track: f.track.value, kos: f.kos.value, t: dariInput(f.t.value) })));
          if (h.tTerima) itemHantar(h).forEach((it) => { it.arkib = h.tTerima; });
        }, 'Hantaran disimpan.');
        return '';
      },
    });
  }

  function terimaHantar(h) {
    if (!h) return;
    ubah(() => {
      h.tTerima = Date.now();
      itemHantar(h).forEach((it) => { it.arkib = h.tTerima; });
    }, h.orang + ' sahkan terima. Item dipindah ke Arkib.');
  }

  /* ---------- Item: butiran ---------- */

  let butirId = null;
  function bukaButir(id) {
    butirId = id;
    if (paparButir()) buka($('dlgButir'));
  }

  function htmlKos(it) {
    if (it.kat === 'luar') return '';
    const k = kosItem(it);
    const o = it.orderId ? cariOrder(it.orderId) : null;
    if (k.barang === null) {
      return '<div class="kotak-kos"><b>Kos dan untung</b><p class="nota">' +
        (o ? 'Isi harga beli item ini' + (o.mata === 'USD' && !o.kadar ? ' dan kadar tukaran order' : '') : 'Isi kos (RM) item ini') +
        ' untuk kira untung. Tekan Edit.</p></div>';
    }
    const baris = [];
    if (o && it.beli !== null) baris.push(['Barang (' + wang(beliAsal(it), mataSimbol(o.mata)) + (o.mata === 'USD' ? ' × ' + o.kadar : '') + ')', k.barang]);
    else baris.push([it.anggaran ? 'Kos barang (anggaran)' : 'Kos barang', k.barang]);
    if (k.shipCM) baris.push(['Shipping ' + (o ? o.kedai : ''), k.shipCM]);
    if (k.bns) baris.push(['Posting BNS', k.bns]);
    if (k.jnt) baris.push(['J&T', k.jnt]);
    let html = '<div class="kotak-kos"><b>Kos dan untung</b><dl>' + baris.map((b) => '<dt>' + esc(b[0]) + '</dt><dd>' + rm(b[1]) + '</dd>').join('') +
      '<dt class="jum">Kos sebenar</dt><dd class="jum">' + rm(k.jumlah) + '</dd>';
    if (it.kat === 'jual') {
      const u = bulat(it.harga - k.jumlah);
      html += '<dt>Harga jual</dt><dd>' + rm(it.harga) + '</dd><dt class="jum">Untung</dt><dd class="jum ' + (u < 0 ? 'rugi' : 'untung') + '">' + rm(u) + '</dd>';
    }
    const kk = it.kotakId ? cariKotak(it.kotakId) : null;
    html += '</dl>' + (kk && kk.kos === null ? '<p class="nota">Kos posting BNS kotak belum diisi.</p>' : '') + '</div>';
    return html;
  }

  function aksiUtama(it) {
    const p = peringkat(it);
    return {
      beli: ['declare', 'Rekod penghantaran ke BNS (declare)'],
      ship: ['hub', 'Tiba di gudang'],
      keHK: ['hk', 'Tiba di hub'],
      hk: ['kotak', 'Consolidate (masuk kotak)'],
      hub: ['keHK', 'Dihantar ke hub'],
      kotak: ['bukaKotak', 'Buka kotak · isi Skynet'],
      post: ['bukaKotak', 'Buka kotak'],
      sampai: it.kat === 'aku' ? ['ambil', 'Diterima · selesai'] : ['serah', 'Hantar kepada pelanggan'],
      hantar: ['terima', 'Pelanggan sahkan terima'],
      luar: ['ambil', 'Barang diterima · arkib'],
      selesai: ['pulih', 'Pulihkan dari Arkib'],
    }[p];
  }

  function paparButir() {
    const it = cariItem(butirId);
    if (!it) { tutup($('dlgButir')); return false; }
    const st = status(it);
    const h = Number(it.harga) || 0;
    const b = dibayar(it);
    const bk = baki(it);
    const p = peringkat(it);
    const luar = it.kat === 'luar';
    const aku = it.kat === 'aku';
    const o = it.orderId ? cariOrder(it.orderId) : null;
    const k = it.kotakId ? cariKotak(it.kotakId) : null;
    const hh = it.hantarId ? cariHantar(it.hantarId) : null;

    let html = (srcGambar(it.gambar)
      ? '<button type="button" class="butir-gambar" data-aksi="gambar"><img src="' + esc(srcGambar(it.gambar)) + '" alt="' + esc(labelItem(it)) + '"></button>'
      : '<button type="button" class="tambah-gambar" data-aksi="gambar">+ Gambar item</button>') +
      '<div class="butir-kepala"><h2>' + (it.jenis ? '<span class="jenis">' + esc(it.jenis) + '</span>' : '') +
      esc(it.nama) + (it.qty > 1 ? ' <span class="qty">×' + it.qty + '</span>' : '') + '</h2>' +
      (aku ? '<span class="pil st-aku">Sendiri</span>' : '<span class="pil st-' + st + '">' + STATUS[st] + '</span>') + '</div>';
    html += '<p class="butir-sub">' + (aku ? 'Barang sendiri' : esc(luar ? 'Penjual: ' : 'Pelanggan: ') + '<b>' + esc(it.orang || '-') + '</b>') +
      (it.tel ? ' · <a href="tel:' + esc(it.tel.replace(/[^\d+]/g, '')) + '">' + esc(it.tel) + '</a>' : '') +
      (luar ? '' : '<br>' + esc(PERINGKAT[p] || '')) + '</p>';

    if (!aku || h > 0 || b > 0) {
      html += '<div class="wang3"><div><span>' + (it.kat === 'jual' ? 'Harga jual' : 'Harga') + '</span><b>' + rm(h) + '</b></div>' +
        '<div><span>' + (luar || aku ? 'Telah dibayar' : 'Diterima') + '</span><b>' + rm(b) + '</b></div>' +
        '<div class="baki' + (bk <= 0 ? ' sifar' : '') + '"><span>' + (bk < 0 ? 'Terlebih' : 'Baki') + '</span><b>' + rm(Math.abs(bk)) + '</b></div></div>';
    }

    const [aU, lU] = aksiUtama(it);
    html += '<div class="grid-aksi">';
    html += '<button class="btn utama penuh" type="button" data-aksi="' + aU + '">' + esc(lU) + '</button>';
    html += '<button class="btn" type="button" data-aksi="bayar">+ Bayaran</button>';
    html += bk > 0 ? '<button class="btn hijau" type="button" data-aksi="penuh">Bayar penuh</button>' : '<button class="btn" type="button" data-aksi="edit">Edit</button>';
    if (it.kat === 'jual' && bk > 0) html += '<button class="btn penuh btn-wa" type="button" data-aksi="wa">' + IKON_WA + 'WhatsApp minta baki</button>';
    html += '</div>';

    if (!luar) {
      html += garisMasa([
        { label: 'Dibeli' + (o ? ' · ' + o.kedai : ''), t: o ? o.tBeli : null, kosong: 'Tiada order', sub: o && o.no ? esc(o.no) : '' },
        { label: 'Dihantar ke gudang', t: it.tShip, sub: it.trackUS ? esc(it.trackUS) : '', salin: it.trackUS, jejak: 'us' },
        { label: 'Tiba di gudang', t: it.tHub },
        { label: 'Dihantar ke hub', t: it.tKeHK },
        { label: 'Tiba di hub', t: it.tHK },
        { label: 'Consolidate', t: k ? k.tBuat : null, sub: k ? esc(namaKotak(k)) : '' },
        { label: 'Dipost ke MY', t: k && k.tPost, sub: k && k.trackMY ? 'Skynet ' + esc(k.trackMY) : '', salin: k && k.trackMY, jejak: 'skynet' },
        { label: 'Tiba di Malaysia', t: k && k.tSampai },
        aku ? null : { label: hh && hh.cara === 'sendiri' ? 'Hantar sendiri' : 'Post J&T', t: hh ? hh.t : null, sub: hh && hh.track ? esc(hh.track) : '', salin: hh && hh.track, jejak: 'jnt' },
        { label: 'Selesai', t: it.arkib },
      ].filter(Boolean), { tempoh: !!o, selesai: !!it.arkib });
      const hk = hariKeseluruhan(it);
      if (hk !== null) html += '<p class="gm-jumlah">' + (it.arkib ? 'Jumlah ' + teksHari(hk) + ' dari order CM hingga selesai' : 'Sudah ' + teksHari(hk) + ' sejak order CM') + '</p>';
      html += '<div class="baris-btn pautan-kecil">' +
        (o ? '<button type="button" class="btn kecil" data-aksi="bukaOrder">Order ' + esc(o.no || '') + ' ›</button>' : '') +
        (k ? '<button type="button" class="btn kecil" data-aksi="bukaKotak">' + esc(namaKotak(k)) + ' ›</button>' : '') +
        '<button type="button" class="btn kecil" data-aksi="perjalanan">Betulkan tarikh</button></div>';
    }

    html += htmlKos(it);
    if (it.catatan) html += '<div class="catatan-penuh">' + esc(it.catatan) + '</div>';

    const undur = {
      ship: 'Batal declare · kembali ke Tempahan', hub: 'Undur · belum tiba di gudang',
      keHK: 'Undur · masih di gudang', hk: 'Undur · belum tiba di hub',
      kotak: 'Keluarkan dari kotak', post: 'Keluarkan dari kotak', sampai: 'Keluarkan dari kotak', hantar: 'Batal penghantaran · kembali ke Tiba',
    }[p];
    html += '<div class="grid-aksi" style="margin-top:12px">' +
      (undur ? '<button class="btn penuh" type="button" data-aksi="undur">' + esc(undur) + '</button>' : '') +
      (bk > 0 ? '<button class="btn" type="button" data-aksi="edit">Edit item</button>' : '') +
      '<button class="btn bahaya' + (bk > 0 ? '' : ' penuh') + '" type="button" data-aksi="padam">Padam</button></div>';

    html += '<h3>Sejarah bayaran</h3>';
    const sej = (it.bayaran || []).slice().sort((x, y) => y.t - x.t);
    if (!sej.length) html += '<p class="nota">Belum ada bayaran.</p>';
    else {
      html += '<ul class="sejarah">' + sej.map((pb) =>
        '<li><span class="tarikh">' + tarikh(pb.t) + '</span><span class="isi">' + (pb.nota ? esc(pb.nota) : '<small>Bayaran</small>') +
        '</span><span class="amaun' + (pb.amaun < 0 ? ' tolak' : '') + '">' + rm(pb.amaun) + '</span>' +
        '<button class="buang" type="button" data-aksi="buangBayar" data-bid="' + esc(pb.id) + '" aria-label="Buang bayaran ' + rm(pb.amaun) + '">' + IKON_BUANG + '</button></li>').join('') + '</ul>';
    }
    html += '<div class="aksi-bawah"><button class="btn" type="button" data-aksi="tutup">Tutup</button></div>';
    $('butirIsi').innerHTML = html;
    return true;
  }

  $('butirIsi').addEventListener('click', async (e) => {
    const sal = e.target.closest('[data-salin]');
    if (sal) { salin(sal.dataset.salin); return; }
    const b = e.target.closest('[data-aksi]');
    if (!b) return;
    const it = cariItem(butirId);
    if (!it) return;
    const a = b.dataset.aksi;

    if (a === 'tutup') tutup($('dlgButir'));
    else if (a === 'bayar') bukaBayar(it);
    else if (a === 'edit') borangItem(it);
    else if (a === 'perjalanan') borangPerjalanan(it);
    else if (a === 'gambar') borangGambar(it);
    else if (a === 'undur') {
      const p = peringkat(it);
      ubah(() => {
        if (['hub', 'keHK', 'hk'].includes(p)) undurSatu(it);
        else if (p === 'ship') undurKeBeli(it);
        else if (p === 'hantar') it.hantarId = null;
        else { it.kotakId = null; ['tHub', 'tKeHK', 'tHK'].forEach((x) => { if (!it[x]) it[x] = it.tShip || Date.now(); }); }
      }, () => labelItem(it) + ': ' + PERINGKAT[peringkat(it)] + '.');
    }
    else if (a === 'bukaOrder') bukaOrder(it.orderId);
    else if (a === 'bukaKotak') bukaKotak(it.kotakId);
    else if (a === 'declare') borangDeclare([it.id]);
    else if (a === 'hub') tandaHub(sekumpulan(it));
    else if (a === 'keHK') tandaMasa(sekumpulan(it), 'tKeHK', 'dihantar ke hub.');
    else if (a === 'hk') tandaMasa(sekumpulan(it), 'tHK', 'tiba di hub.');
    else if (a === 'kotak') pilihKotak(it);
    else if (a === 'serah') borangSerah(kunciOrang(it.orang), [it.id]);
    else if (a === 'terima') terimaHantar(cariHantar(it.hantarId));
    else if (a === 'ambil') ubah(() => { it.arkib = Date.now(); }, labelItem(it) + ' diarkibkan.');
    else if (a === 'pulih') {
      ubah(() => {
        it.arkib = null;
        const h = it.hantarId ? cariHantar(it.hantarId) : null;
        if (h) h.tTerima = null;
      }, labelItem(it) + ' dipulihkan.');
    } else if (a === 'penuh') {
      const bk = baki(it);
      ubah(() => { it.bayaran.push({ id: idBaru(), amaun: bk, t: Date.now(), nota: 'Bayar penuh' }); }, 'Bayaran ' + rm(bk) + ' direkod.');
    } else if (a === 'wa') waBaki([it]);
    else if (a === 'padam') {
      const ok = await sahkan({
        tajuk: 'Padam item ini?',
        teks: labelItem(it) + (it.orang ? ' (' + it.orang + ')' : '') + ' dan sejarah bayarannya akan dipadam.',
        ya: 'Padam', bahaya: true,
      });
      if (!ok) return;
      ubah(() => { data.items = data.items.filter((x) => x !== it); }, labelItem(it) + ' dipadam.');
      tutup($('dlgButir'));
    } else if (a === 'buangBayar') {
      const pb = it.bayaran.find((x) => x.id === b.dataset.bid);
      if (!pb) return;
      const ok = await sahkan({ tajuk: 'Buang bayaran ini?', teks: rm(pb.amaun) + ' pada ' + tarikh(pb.t) + (pb.nota ? ' (' + pb.nota + ')' : ''), ya: 'Buang', bahaya: true });
      if (!ok) return;
      ubah(() => { it.bayaran = it.bayaran.filter((x) => x !== pb); }, 'Bayaran dibuang.');
    }
  });

  // Dari item di hub: pilih kotak yang belum dipost, atau kotak baru.
  function pilihKotak(it) {
    const terbuka = data.kotak.filter((k) => !k.tPost).sort((a, b) => b.tBuat - a.tBuat);
    if (!terbuka.length) { borangKotak(null, [it.id]); return; }
    const pilihan = terbuka.map((k, i) => ({ nilai: k.id, label: namaKotak(k), sub: itemKotak(k).length + ' item', pilih: i === 0 }));
    pilihan.push({ nilai: '__baru', label: '+ Kotak baru', sub: 'Consolidate baru di BNS' });
    borang({
      tajuk: 'Masuk kotak',
      html: senaraiPilih('kotak', pilihan, 'radio'),
      simpan: 'Pilih',
      hantar(f) {
        const v = nilaiPilih(f, 'kotak')[0];
        if (!v) return 'Pilih satu kotak.';
        if (v === '__baru') { setTimeout(() => borangKotak(null, [it.id]), 0); return ''; }
        const k = cariKotak(v);
        ubah(() => { it.kotakId = k.id; ['tHub', 'tKeHK', 'tHK'].forEach((x) => { if (!it[x]) it[x] = k.tBuat; }); }, 'Masuk ' + namaKotak(k) + '.');
        return '';
      },
    });
  }

  function borangPerjalanan(it) {
    const kotakPilih = '<label class="medan">Kotak<select name="kotak"><option value="">Tiada</option>' +
      data.kotak.map((k) => '<option value="' + esc(k.id) + '"' + (it.kotakId === k.id ? ' selected' : '') + '>' + esc(namaKotak(k)) + ' · ' + esc(labelKotak(k)) + '</option>').join('') + '</select></label>';
    borang({
      tajuk: 'Betulkan tarikh',
      nota: esc(labelItem(it)) + '. Tarikh kotak (post, sampai) diubah dari skrin kotak.',
      html: '<div class="dua">' + medanTarikh('tShip', 'Dihantar ke gudang', it.tShip) + medanTeks('trackUS', 'Tracking US', it.trackUS, ' maxlength="60"') + '</div>' +
        '<div class="dua">' + medanTarikh('tDeclare', 'Declare BNS', it.tDeclare) + medanTarikh('tHub', 'Tiba di gudang', it.tHub) + '</div>' +
        '<div class="dua">' + medanTarikh('tKeHK', 'Dihantar ke hub', it.tKeHK) + medanTarikh('tHK', 'Tiba di hub', it.tHK) + '</div>' + kotakPilih,
      hantar(f) {
        ubah(() => {
          it.tShip = tarikhAtauNull(f.tShip.value);
          it.trackUS = f.trackUS.value.trim().slice(0, 60);
          it.tDeclare = tarikhAtauNull(f.tDeclare.value);
          it.tHub = tarikhAtauNull(f.tHub.value);
          it.tKeHK = tarikhAtauNull(f.tKeHK.value);
          it.tHK = tarikhAtauNull(f.tHK.value);
          it.kotakId = f.kotak.value || null;
          if (it.kotakId && !it.tShip) it.tShip = cariKotak(it.kotakId).tBuat;
        }, 'Disimpan.');
        return '';
      },
    });
  }

  /* ---------- Gambar item ---------- */

  /*
    Gambar yang dimuat naik disimpan berasingan daripada data utama supaya data kekal kecil:
    dalam peranti (IndexedDB), dan satu fail bagi setiap gambar dalam folder apps Google Drive.
    Item hanya simpan rujukan 'g:<cincang>'. Gambar yang sama (contoh: item bernama sama)
    disimpan sekali sahaja. Pautan https:// kekal seperti biasa.
  */
  const AWALAN_GB = 'g:';
  const urlGambar = new Map(); // cincang -> object URL
  let siapGambar = Promise.resolve(); // selesai bila gambar dalam peranti sudah dimuat
  const hashGambar = (v) => (typeof v === 'string' && v.startsWith(AWALAN_GB) ? v.slice(AWALAN_GB.length) : '');
  function srcGambar(v) {
    if (!v) return '';
    const h = hashGambar(v);
    return h ? urlGambar.get(h) || '' : v;
  }
  let idbJanji = null;
  function bukaIdb() {
    if (!idbJanji) {
      idbJanji = new Promise((ok, gagal) => {
        if (!window.indexedDB) { gagal(new Error('idb')); return; }
        const r = indexedDB.open('diecast-gambar', 1);
        r.onupgradeneeded = () => r.result.createObjectStore('g');
        r.onsuccess = () => ok(r.result);
        r.onerror = () => gagal(r.error);
      });
      idbJanji.catch(() => { idbJanji = null; });
    }
    return idbJanji;
  }
  // fn(store) boleh pulangkan request; hasilnya dipulangkan selepas transaksi selesai.
  async function idb(mod, fn) {
    const db = await bukaIdb();
    return new Promise((ok, gagal) => {
      const tx = db.transaction('g', mod);
      let hasil;
      const r = fn(tx.objectStore('g'));
      if (r) r.onsuccess = () => { hasil = r.result; };
      tx.oncomplete = () => ok(hasil);
      tx.onerror = () => gagal(tx.error);
      tx.onabort = () => gagal(tx.error);
    });
  }
  function semuaGambarIdb(fn) {
    return idb('readonly', (st) => {
      const r = st.openCursor();
      r.onsuccess = () => { const c = r.result; if (c) { fn(c.key, c.value); c.continue(); } };
      return null;
    });
  }
  async function cincang(blob) {
    const buf = new Uint8Array(await blob.arrayBuffer());
    if (window.crypto && crypto.subtle) {
      const d = new Uint8Array(await crypto.subtle.digest('SHA-256', buf));
      return [...d.slice(0, 12)].map((b) => b.toString(16).padStart(2, '0')).join('');
    }
    let a = 0x811c9dc5, b = 0x01000193 ^ buf.length;
    for (let i = 0; i < buf.length; i++) { a = Math.imul(a ^ buf[i], 16777619) >>> 0; b = Math.imul(b ^ buf[i], 2246822519) >>> 0; }
    return a.toString(16).padStart(8, '0') + b.toString(16).padStart(8, '0') + buf.length.toString(16).padStart(8, '0');
  }
  async function simpanBlob(blob, h) {
    h = h || await cincang(blob);
    if (!urlGambar.has(h)) {
      await idb('readwrite', (st) => st.put(blob, h));
      urlGambar.set(h, URL.createObjectURL(blob));
    }
    return AWALAN_GB + h;
  }
  const dataKeBlob = async (d) => (await fetch(d)).blob();
  function blobKeData(blob) {
    return new Promise((ok, gagal) => { const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = () => gagal(r.error); r.readAsDataURL(blob); });
  }
  const bacaBlob = (h) => idb('readonly', (st) => st.get(h));
  // Gambar dari galeri / kamera: kecilkan, simpan dalam peranti, pulangkan rujukan.
  async function gambarDariFail(fail) {
    const d = await kecilkanGambar(fail);
    try { return await simpanBlob(await dataKeBlob(d)); } catch (e) { return d; } // tiada IndexedDB: simpan terus dalam data
  }
  // Item baru tanpa gambar guna gambar item lain yang bernama sama.
  function gambarSama(jenis, nama) {
    const k = kunciOrang((jenis || '') + ' ' + (nama || ''));
    const x = data.items.find((y) => y.gambar && kunciOrang(y.jenis + ' ' + y.nama) === k);
    return x ? x.gambar : '';
  }
  async function muatGambar() {
    try { await semuaGambarIdb((h, blob) => { if (!urlGambar.has(h)) urlGambar.set(h, URL.createObjectURL(blob)); }); } catch (e) { /* tiada IndexedDB */ }
  }
  // Pindahkan gambar lama (data URL dalam data) ke simpanan gambar.
  async function pindahGambar() {
    const lama = data.items.filter((it) => /^data:image\//.test(it.gambar || ''));
    if (!lama.length) return 0;
    const peta = new Map();
    for (const it of lama) {
      if (peta.has(it.gambar)) continue;
      try { peta.set(it.gambar, await simpanBlob(await dataKeBlob(it.gambar))); } catch (e) { peta.set(it.gambar, null); }
    }
    let n = 0;
    lama.forEach((it) => { const r = peta.get(it.gambar); if (r) { it.gambar = r; n++; } });
    if (n) simpan();
    return n;
  }
  // Buang gambar dalam peranti yang tiada item lagi merujuknya.
  async function kemasGambar() {
    const guna = new Set(data.items.map((it) => hashGambar(it.gambar)).filter(Boolean));
    const buang = [...urlGambar.keys()].filter((h) => !guna.has(h));
    if (!buang.length) return;
    try {
      await idb('readwrite', (st) => { buang.forEach((h) => st.delete(h)); return null; });
      buang.forEach((h) => { URL.revokeObjectURL(urlGambar.get(h)); urlGambar.delete(h); });
    } catch (e) { /* cuba lain kali */ }
  }
  async function saizStoran() {
    let n = 0, bait = 0;
    try { await semuaGambarIdb((h, blob) => { n++; bait += blob.size || 0; }); } catch (e) { /* tiada IndexedDB */ }
    let dataBait = 0;
    try { dataBait = new Blob([localStorage.getItem(KUNCI) || '']).size; } catch (e) { /* abai */ }
    const tiadaGb = data.items.filter((it) => hashGambar(it.gambar) && !urlGambar.has(hashGambar(it.gambar))).length;
    return { n, bait, dataBait, tiadaGb };
  }
  const saizTeks = (b) => (b >= 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB');
  async function paparStoran() {
    const s = await saizStoran();
    $('storanNota').textContent = 'Data: ' + saizTeks(s.dataBait) + ' (had peranti lebih kurang 5 MB). Gambar: ' + s.n + ' fail, ' + saizTeks(s.bait) +
      ' (disimpan berasingan, tiada had ketat).' + (s.tiadaGb ? ' ' + s.tiadaGb + ' item menunggu gambar dari Google Drive.' : '');
  }

  // Kecilkan gambar (sisi terpanjang 480px, JPEG) supaya data kecil dan laju diselaras.
  function kecilkanGambar(fail) {
    return new Promise((ok, gagal) => {
      const url = URL.createObjectURL(fail);
      const img = new Image();
      img.onload = () => {
        const max = 480;
        const skala = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
        const c = document.createElement('canvas');
        c.width = Math.round(img.naturalWidth * skala);
        c.height = Math.round(img.naturalHeight * skala);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        ok(c.toDataURL('image/jpeg', 0.72));
      };
      img.onerror = () => { URL.revokeObjectURL(url); gagal(new Error('gambar')); };
      img.src = url;
    });
  }

  function borangGambar(it) {
    const sama = data.items.filter((x) => x !== it && kunciOrang(x.jenis + ' ' + x.nama) === kunciOrang(it.jenis + ' ' + it.nama) && !x.gambar);
    borang({
      tajuk: 'Gambar item',
      nota: esc(labelItem(it)),
      html: '<label class="pratonton-gambar" id="pratonton"><input type="file" accept="image/*" name="fail" hidden><span class="pg-isi"></span></label>' +
        '<input type="hidden" name="gambar" value="' + esc(it.gambar) + '">' +
        '<div class="baris-btn" data-ada-gambar' + (it.gambar ? '' : ' hidden') + '><button type="button" class="btn bahaya kecil" data-buang-gambar="1">Buang gambar</button></div>' +
        medanTeks('pautan', 'Atau tampal pautan gambar', /^https?:/.test(it.gambar) ? it.gambar : '', ' type="url" inputmode="url" placeholder="https://…"') +
        (sama.length ? '<label class="tanda"><input type="checkbox" name="semua" checked> Guna juga untuk ' + sama.length + ' item lain bernama sama</label>' : ''),
      lepas: (f) => {
        const IKON_KAMERA = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 8h3l1.5-2h7L17 8h3a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z"/><circle cx="12" cy="13" r="3.5"/></svg>';
        const tunjuk = (src) => {
          f.querySelector('#pratonton .pg-isi').innerHTML = src
            ? '<img src="' + esc(src) + '" alt=""><span class="pg-tukar">Ketik untuk tukar</span>'
            : '<span class="pg-kosong">' + IKON_KAMERA + '<b>Ketik untuk pilih / ambil gambar</b></span>';
          f.querySelector('[data-ada-gambar]').hidden = !src;
        };
        tunjuk(srcGambar(it.gambar));
        f.fail.addEventListener('change', async () => {
          const fail = f.fail.files && f.fail.files[0];
          if (!fail) return;
          try { f.gambar.value = await gambarDariFail(fail); f.pautan.value = ''; tunjuk(srcGambar(f.gambar.value)); }
          catch (e) { toast('Gambar tidak dapat dibaca.'); }
        });
        f.pautan.addEventListener('change', () => { const v = f.pautan.value.trim(); f.gambar.value = v; tunjuk(v); });
        const bg = f.querySelector('[data-buang-gambar]');
        if (bg) bg.addEventListener('click', () => { f.gambar.value = ''; f.pautan.value = ''; tunjuk(''); });
      },
      hantar(f) {
        const v = f.pautan.value.trim() || f.gambar.value;
        if (v && !/^(https?:|data:image\/|g:)/.test(v)) return 'Pautan gambar mesti bermula dengan https://';
        ubah(() => {
          it.gambar = v;
          if (v && f.semua && f.semua.checked) sama.forEach((x) => { x.gambar = v; });
        }, v ? 'Gambar disimpan.' : 'Gambar dibuang.');
        return '';
      },
    });
  }

  /* ---------- Imbas barcode (tracking J&T) ---------- */

  // Guna BarcodeDetector (Chrome/Android) kalau ada; kalau tiada, muat ZXing dari CDN.
  let zxingJanji = null;
  function muatZxing() {
    if (window.ZXing) return Promise.resolve();
    if (!zxingJanji) {
      zxingJanji = new Promise((ok, gagal) => {
        const sk = document.createElement('script');
        sk.src = 'https://cdn.jsdelivr.net/npm/@zxing/library@0.21.3/umd/index.min.js';
        sk.onload = () => ok();
        sk.onerror = () => { zxingJanji = null; gagal(new Error('zxing')); };
        document.head.appendChild(sk);
      });
    }
    return zxingJanji;
  }

  const sesuaiTracking = (v) => /^[A-Z]{0,3}\d{10,18}$/i.test(v);

  // Baca barcode dari gambar (contoh: screenshot label J&T dalam galeri).
  async function bacaBarcodeGambar(fail) {
    const hasil = [];
    if ('BarcodeDetector' in window) {
      try {
        const ada = await window.BarcodeDetector.getSupportedFormats();
        const pengesan = new window.BarcodeDetector({ formats: ['code_128', 'code_39', 'code_93', 'codabar', 'itf', 'ean_13', 'qr_code'].filter((x) => ada.includes(x)) });
        const bmp = await createImageBitmap(fail);
        (await pengesan.detect(bmp)).forEach((h) => hasil.push(h.rawValue));
      } catch (e) { /* cuba ZXing */ }
    }
    if (!hasil.length) {
      await muatZxing();
      const url = URL.createObjectURL(fail);
      try {
        const r = await new window.ZXing.BrowserMultiFormatReader().decodeFromImageUrl(url);
        if (r) hasil.push(r.getText());
      } catch (e) { /* tiada barcode dijumpai */ } finally { URL.revokeObjectURL(url); }
    }
    return hasil;
  }

  function imbas() {
    return new Promise((selesai) => {
      const dlg = $('dlgImbas');
      const video = $('imbasVideo');
      const status = $('imbasStatus');
      const calon = $('imbasCalon');
      let strim = null;
      let pembaca = null;
      let habis = false;
      let pemasa = null;
      calon.innerHTML = '';
      status.textContent = 'Menghidupkan kamera…';
      const dijumpai = new Set();
      const tamat = (nilai) => {
        if (habis) return;
        habis = true;
        clearTimeout(pemasa);
        try { if (pembaca) pembaca.reset(); } catch (e) { /* tak penting */ }
        if (strim) strim.getTracks().forEach((t) => t.stop());
        video.srcObject = null;
        if (dlg.open) dlg.close();
        if (nilai && navigator.vibrate) navigator.vibrate(60);
        selesai(nilai || null);
      };
      const terima = (v) => {
        v = String(v || '').trim();
        if (!v || habis) return;
        if (sesuaiTracking(v)) { tamat(v); return; }
        if (dijumpai.has(v)) return;
        dijumpai.add(v);
        calon.insertAdjacentHTML('beforeend', '<button type="button" class="btn kecil" data-guna="' + esc(v) + '">Guna ' + esc(v) + '</button>');
      };
      calon.onclick = (e) => { const b = e.target.closest('[data-guna]'); if (b) tamat(b.dataset.guna); };
      $('imbasBatal').onclick = () => tamat(null);
      $('imbasFail').value = '';
      $('imbasFail').onchange = async () => {
        const fail = $('imbasFail').files && $('imbasFail').files[0];
        if (!fail) return;
        status.textContent = 'Membaca gambar…';
        try {
          const hasil = await bacaBarcodeGambar(fail);
          if (!hasil.length) { status.textContent = 'Tiada barcode dijumpai dalam gambar. Cuba gambar yang lebih jelas atau potong pada barcode.'; return; }
          hasil.forEach(terima);
          if (!habis) status.textContent = 'Pilih nombor tracking yang betul.';
        } catch (e) { status.textContent = 'Gambar tidak dapat dibaca.'; }
      };
      dlg.onclose = () => tamat(null);
      dlg.showModal();

      (async () => {
        try {
          if ('BarcodeDetector' in window) {
            const ada = await window.BarcodeDetector.getSupportedFormats();
            const mahu = ['code_128', 'code_39', 'code_93', 'codabar', 'itf', 'ean_13', 'qr_code'].filter((x) => ada.includes(x));
            const pengesan = new window.BarcodeDetector({ formats: mahu });
            strim = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
            if (habis) { strim.getTracks().forEach((t) => t.stop()); return; }
            video.srcObject = strim;
            await video.play();
            status.textContent = 'Halakan kamera pada barcode J&T.';
            const ulang = async () => {
              if (habis) return;
              try {
                const hasil = await pengesan.detect(video);
                hasil.forEach((h) => terima(h.rawValue));
              } catch (e) { /* bingkai belum sedia */ }
              pemasa = setTimeout(ulang, 180);
            };
            ulang();
          } else {
            await muatZxing();
            if (habis) return;
            pembaca = new window.ZXing.BrowserMultiFormatReader();
            status.textContent = 'Halakan kamera pada barcode J&T.';
            await pembaca.decodeFromConstraints({ video: { facingMode: 'environment' } }, video, (res) => { if (res) terima(res.getText()); });
          }
        } catch (e) {
          status.textContent = e && e.name === 'NotAllowedError'
            ? 'Akses kamera ditolak. Benarkan kamera untuk laman ini dalam tetapan browser.'
            : 'Kamera atau pengimbas tidak dapat dibuka. Taip nombor tracking sendiri.';
        }
      })();
    });
  }

  function butangImbas(namaMedan) {
    return '<button type="button" class="btn kecil btn-imbas" data-imbas="' + namaMedan + '">' +
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7V5a1 1 0 0 1 1-1h2M17 4h2a1 1 0 0 1 1 1v2M20 17v2a1 1 0 0 1-1 1h-2M7 20H5a1 1 0 0 1-1-1v-2"/><path d="M7 8v8M10 8v8M13 8v8M16 8v8"/></svg>Imbas barcode</button>';
  }
  $('formX').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-imbas]');
    if (!b) return;
    const nilai = await imbas();
    if (nilai) {
      const medan = $('formX').querySelector('[name="' + b.dataset.imbas + '"]');
      if (medan) { medan.value = nilai; medan.dispatchEvent(new Event('input', { bubbles: true })); }
      toast('Tracking ' + nilai + ' diimbas.');
    }
  });

  /* ---------- Item: tambah / edit ---------- */

  function borangItem(it, opt) {
    opt = opt || {};
    isiDatalistOrang();
    const kat = it ? it.kat : opt.kat || 'jual';
    const luar = kat === 'luar';
    const ordPilih = luar ? '' : '<label class="medan">Order<select name="orderId"><option value="">Tiada order</option>' +
      data.orders.slice().sort((a, b) => b.tBeli - a.tBeli).map((o) => '<option value="' + esc(o.id) + '"' +
        ((it ? it.orderId : opt.orderId) === o.id ? ' selected' : '') + '>' + esc(labelOrder(o)) + ' · ' + tarikh(o.tBeli) + '</option>').join('') + '</select></label>';
    const nilai = it || { jenis: '', nama: '', qty: 1, orang: '', tel: '', harga: '', beli: null, modal: null, catatan: '' };
    let html = '';
    if (!luar) {
      html += '<fieldset class="pilih-kat dua-pilih"><legend>Untuk</legend>' +
        '<label><input type="radio" name="kat" value="jual"' + (kat === 'jual' ? ' checked' : '') + '><span>Pelanggan</span></label>' +
        '<label><input type="radio" name="kat" value="aku"' + (kat === 'aku' ? ' checked' : '') + '><span>Sendiri</span></label></fieldset>';
    }
    html += '<div class="dua"><label class="medan kecil">Jenis<input name="jenis" list="senaraiJenis" maxlength="20" value="' + esc(nilai.jenis) + '"></label>' +
      '<label class="medan">Item<input name="nama" maxlength="80" required value="' + esc(nilai.nama) + '"' + (it ? '' : ' data-fokus') + '></label></div>' +
      '<div class="dua"><label class="medan kecil">Qty<input name="qty" type="number" inputmode="numeric" min="1" step="1" value="' + esc(nilai.qty) + '"></label>' +
      '<label class="medan" data-orang>' + (luar ? 'Beli dari' : 'Pelanggan') + '<input name="orang" list="senaraiOrang" maxlength="60" value="' + esc(kat === 'aku' ? '' : nilai.orang) + '"></label></div>' +
      '<div data-orang>' + medanTeks('tel', 'No. telefon <small>(pilihan)</small>', nilai.tel, ' type="tel" inputmode="tel" maxlength="30"') + '</div>' +
      '<div data-harga>' + medanNombor('harga', luar ? 'Harga (RM)' : 'Harga jual (RM)', nilai.harga || '') + '</div>';
    if (!it) html += medanNombor('bayarAwal', luar ? 'Telah dibayar (RM)' : 'Telah dibayar (RM)', '');
    if (!luar) {
      html += ordPilih +
        '<div class="dua"><label class="medan" data-beli>Harga beli seunit <small>(mata wang order)</small><input name="beli" type="number" inputmode="decimal" min="0" step="0.01" value="' + esc(nilai.beli === null ? '' : nilai.beli) + '"></label>' +
        '<label class="medan" data-modal>Kos RM <small>(tanpa order)</small><input name="modal" type="number" inputmode="decimal" min="0" step="0.01" value="' + esc(nilai.modal === null ? '' : nilai.modal) + '"></label></div>';
    }
    html += '<label class="medan">Catatan <small>(pilihan)</small><textarea name="catatan" rows="2" maxlength="300">' + esc(nilai.catatan) + '</textarea></label>';

    borang({
      tajuk: it ? 'Edit item' : luar ? 'Tambah barang personal' : 'Tambah item',
      nota: luar && !it ? 'Barang yang dibeli daripada pihak lain (contoh: Enal).' : '',
      html,
      lepas: (f) => {
        const segar = () => {
          const k = luar ? 'luar' : f.kat.value;
          f.querySelectorAll('[data-orang]').forEach((el) => { el.hidden = k === 'aku'; });
          if (!luar) {
            const adaOrder = !!f.orderId.value;
            f.querySelector('[data-beli]').hidden = !adaOrder;
            f.querySelector('[data-modal]').hidden = adaOrder;
          }
        };
        f.querySelectorAll('input[name="kat"], select[name="orderId"]').forEach((el) => el.addEventListener('change', segar));
        segar();
        f.orang.addEventListener('change', () => { if (!f.tel.value) f.tel.value = telUntuk(f.orang.value); });
      },
      hantar(f) {
        const k = luar ? 'luar' : f.kat.value;
        if (!f.nama.value.trim()) return 'Isi nama item.';
        if (k !== 'aku' && !f.orang.value.trim()) return luar ? 'Isi nama penjual.' : 'Isi nama pelanggan.';
        const v = {
          kat: k, jenis: f.jenis.value, nama: f.nama.value, qty: f.qty.value, orang: k === 'aku' ? AKU : f.orang.value, tel: k === 'aku' ? '' : f.tel.value,
          harga: f.harga.value, catatan: f.catatan.value.trim(),
        };
        if (!luar) Object.assign(v, { orderId: f.orderId.value || null, beli: f.orderId.value ? f.beli.value : null, modal: f.orderId.value ? null : f.modal.value });
        if (it) {
          ubah(() => { Object.assign(it, bersihItem(Object.assign({}, it, v))); }, 'Disimpan.');
        } else {
          const awal = bulat(f.bayarAwal.value);
          const baru = bersihItem(Object.assign(v, {
            id: idBaru(), dibuat: Date.now(), urutan: Date.now(),
            bayaran: awal ? [{ id: idBaru(), amaun: awal, t: Date.now(), nota: 'Bayaran awal' }] : [],
          }));
          ubah(() => {
            data.items.push(baru);
            if (luar) { tetapan.tab = 'luar'; simpanTetapan(); }
          }, labelItem(baru) + ' ditambah.');
        }
        return '';
      },
    });
  }

  $('btnTambah').addEventListener('click', () => {
    if (tetapan.tab === 'beli') borangTempahan();
    else if (tetapan.tab === 'otw') borangKotak(null, data.items.filter((it) => peringkat(it) === 'hk').map((it) => it.id));
    else if (tetapan.tab === 'luar') borangItem(null, { kat: 'luar' });
  });
  $('btnTambahMula').addEventListener('click', borangTempahan);

  /* ---------- Bayaran ---------- */

  let bayarId = null;
  function bukaBayar(it) {
    bayarId = it.id;
    const f = $('borangBayar');
    f.reset();
    const bk = baki(it);
    $('bayarTajuk').textContent = it.kat === 'jual' ? 'Bayaran dari ' + (it.orang || 'kastemer') : 'Bayaran dibuat';
    $('bayarNota').textContent = labelItem(it) + ' · harga ' + rm(it.harga) + ', telah dibayar ' + rm(dibayar(it)) + (bk > 0 ? ', baki ' + rm(bk) : '');
    f.amaun.value = bk > 0 ? bk : '';
    f.tarikh.value = tarikhInput();
    const cepat = [];
    if (bk > 0) cepat.push(['Baki ' + rm(bk), bk]);
    [100, 150, 200].forEach((n) => { if (bk <= 0 || n < bk) cepat.push(['Deposit ' + rm(n), n]); });
    $('bayarCepat').innerHTML = cepat.map((c) => '<button type="button" data-n="' + c[1] + '">' + esc(c[0]) + '</button>').join('');
    $('bayarRalat').textContent = '';
    buka($('dlgBayar'));
    setTimeout(() => f.amaun.select(), 50);
  }
  $('bayarCepat').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-n]');
    if (b) $('borangBayar').amaun.value = b.dataset.n;
  });
  $('bayarBatal').addEventListener('click', () => tutup($('dlgBayar')));
  $('borangBayar').addEventListener('submit', (e) => {
    e.preventDefault();
    const f = e.target;
    const it = cariItem(bayarId);
    if (!it) { tutup($('dlgBayar')); return; }
    const n = bulat(f.amaun.value);
    if (!n) { $('bayarRalat').textContent = 'Masukkan jumlah. Guna nombor negatif untuk refund.'; return; }
    tutup($('dlgBayar'));
    ubah(() => { it.bayaran.push({ id: idBaru(), amaun: n, t: dariInput(f.tarikh.value), nota: f.nota.value.trim().slice(0, 80) }); },
      () => rm(n) + ' direkod. Baki kini ' + rm(Math.max(0, baki(it))) + '.');
  });

  /* ---------- Kastemer ---------- */

  let kastemerKunci = null;
  function senaraiKastemer() {
    const aktif = data.items.filter((it) => it.kat === 'jual' && !it.arkib);
    return ikutOrang(aktif).map((g) => Object.assign(g, {
      tel: (g.items.find((it) => it.tel) || {}).tel || '',
      baki: bakiPositif(g.items),
    })).sort((a, b) => (b.baki - a.baki) || a.nama.localeCompare(b.nama));
  }

  function bukaKastemer(kunci) {
    paparKastemer(kunci || null);
    buka($('dlgKastemer'));
  }

  function paparKastemer(kunci) {
    kastemerKunci = kunci;
    const semua = senaraiKastemer();
    let html = '';
    if (!kunci) {
      const jumlah = bulat(semua.reduce((j, g) => j + g.baki, 0));
      html += '<h2>Pelanggan</h2><p class="nota">Barang yang belum selesai. Jumlah baki semua pelanggan: <b>' + rm(jumlah) + '</b></p>';
      if (!semua.length) html += '<p class="kosong">Tiada barang pelanggan yang aktif.</p>';
      html += semua.map((g) => '<button type="button" class="orang-baris" data-k="' + esc(g.kunci) + '"><span class="isi"><b>' + esc(g.nama) + '</b><small>' +
        g.items.length + ' item' + (g.tel ? ' · ' + esc(g.tel) : '') + '</small></span><span class="baki' + (g.baki <= 0 ? ' sifar' : '') + '">' +
        (g.baki > 0 ? rm(g.baki) : 'Lunas') + '</span></button>').join('');
    } else {
      const g = semua.find((x) => x.kunci === kunci);
      if (!g) { paparKastemer(null); return; }
      html += '<button type="button" class="balik" data-k="">‹ Semua pelanggan</button>';
      html += '<h2>' + esc(g.nama) + '</h2>';
      html += '<p class="nota">' + (g.tel ? '<a href="tel:' + esc(g.tel.replace(/[^\d+]/g, '')) + '">' + esc(g.tel) + '</a> · ' : '') +
        g.items.length + ' item · baki <b>' + rm(g.baki) + '</b></p>';
      html += '<div>' + g.items.map((it) => {
        const st = status(it);
        return '<button type="button" class="item-mini boleh" data-item="' + esc(it.id) + '"><i class="titik s-' + st + '"></i><span class="isi">' + esc(labelItem(it)) +
          '<small>' + esc(PERINGKAT[peringkat(it)]) + ' · jual ' + rm(it.harga) + ', bayar ' + rm(dibayar(it)) + '</small></span>' +
          '<span class="baki">' + (baki(it) > 0 ? rm(baki(it)) : STATUS[st]) + '</span></button>';
      }).join('') + '</div>';
      html += '<div class="grid-aksi" style="margin-top:14px">';
      if (g.baki > 0) html += '<button class="btn utama penuh btn-wa" type="button" data-wa="' + esc(g.kunci) + '">' + IKON_WA + 'WhatsApp minta baki</button>';
      html += '<button class="btn penuh" type="button" data-gabung="' + esc(g.kunci) + '">Tukar nama / gabung dengan pelanggan lain</button>';
      html += '</div>';
    }
    html += '<div class="aksi-bawah"><button class="btn" type="button" data-tutup="1">Tutup</button></div>';
    $('kastemerIsi').innerHTML = html;
  }

  $('btnKastemer').addEventListener('click', () => bukaKastemer(null));
  $('kastemerIsi').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.tutup) { tutup($('dlgKastemer')); return; }
    if (b.dataset.item) { bukaButir(b.dataset.item); return; }
    if (b.dataset.gabung) { borangGabung(b.dataset.gabung); return; }
    if (b.dataset.wa) {
      const g = senaraiKastemer().find((x) => x.kunci === b.dataset.wa);
      if (g) waBaki(g.items);
      return;
    }
    if (b.dataset.k !== undefined) { paparKastemer(b.dataset.k || null); $('dlgKastemer').scrollTop = 0; }
  });

  // Satukan dua nama yang sebenarnya orang sama (contoh AZLAN dan NOR AZLAN (FB)).
  // Semua item (termasuk Arkib dan hantaran) bawah nama lama ditukar kepada nama baru.
  function borangGabung(kunci) {
    isiDatalistOrang();
    const its = data.items.filter((it) => it.kat === 'jual' && kunciOrang(it.orang) === kunci);
    if (!its.length) return;
    const lama = its[0].orang;
    const lain = senaraiKastemer().filter((g) => g.kunci !== kunci);
    borang({
      tajuk: 'Tukar nama / gabung',
      nota: esc(lama) + ' · ' + its.length + ' item (termasuk Arkib). Pilih pelanggan sedia ada untuk digabungkan, atau taip nama baru.',
      html: (lain.length ? senaraiPilih('ke', lain.map((g) => ({ nilai: g.nama, label: g.nama, sub: g.items.length + ' item aktif' + (g.tel ? ' · ' + g.tel : '') })), 'radio') : '') +
        medanTeks('nama', 'Atau nama baru', '', ' maxlength="60"') +
        medanTeks('tel', 'No. telefon <small>(kosongkan untuk kekalkan yang ada)</small>', '', ' type="tel" inputmode="tel" maxlength="30"'),
      simpan: 'Simpan',
      hantar(f) {
        const pilih = nilaiPilih(f, 'ke')[0];
        const baru = (f.nama.value.trim() || pilih || '').slice(0, 60);
        if (!baru) return 'Pilih pelanggan atau taip nama baru.';
        const kunciBaru = kunciOrang(baru);
        const tel = f.tel.value.trim() || telUntuk(baru) || (its.find((it) => it.tel) || {}).tel || '';
        ubah(() => {
          data.items.forEach((it) => {
            const k = kunciOrang(it.orang);
            if (it.kat === 'jual' && (k === kunci || k === kunciBaru)) { it.orang = baru; if (tel) it.tel = tel; }
          });
          data.hantar.forEach((h) => { if (kunciOrang(h.orang) === kunci) h.orang = baru; });
        }, kunciOrang(lama) === kunciBaru ? 'Disimpan.' : esc(lama) + ' digabung ke ' + baru + '.');
        paparKastemer(kunciBaru);
        return '';
      },
    });
  }

  /* ---------- WhatsApp ---------- */

  function bukaWa(tel, teks) {
    window.open('https://wa.me/' + noWa(tel) + '?text=' + encodeURIComponent(teks), '_blank', 'noopener');
  }

  function barisBaki(its) {
    return its.map((it) => {
      const b = dibayar(it);
      return '- ' + labelItem(it) + ': harga ' + rm(it.harga) + (b ? ', telah dibayar ' + rm(b) : '') + (baki(it) > 0 ? ', baki ' + rm(baki(it)) : '');
    }).join('\n');
  }

  function waBaki(its) {
    const ada = its.filter((it) => baki(it) > 0);
    if (!ada.length) { toast('Tiada baki.'); return; }
    const jumlah = bakiPositif(ada);
    const sampai = ada.every((it) => peringkat(it) === 'sampai');
    let teks = 'Salam ' + ada[0].orang + '.\n\n' + (sampai ? 'Barang pre-order telah tiba. ' : '') + 'Berikut baki bayaran:\n' + barisBaki(ada) +
      (ada.length > 1 ? '\n\nJumlah baki: ' + rm(jumlah) : '') + '\n';
    if (data.bank) teks += '\n' + data.bank.trim() + '\n';
    teks += '\nTerima kasih.';
    bukaWa(ada.find((it) => it.tel) ? ada.find((it) => it.tel).tel : '', teks);
  }

  function waHantar(h) {
    if (!h) return;
    const its = itemHantar(h);
    const bk = bakiPositif(its);
    const ramai = new Set(its.map((it) => kunciOrang(it.orang))).size > 1;
    const baris = its.map((it) => '- ' + labelItem(it) + (ramai ? ' (' + it.orang + ')' : '')).join('\n');
    let teks = 'Salam ' + h.orang.split(' + ')[0] + '.\n\n';
    if (h.cara === 'pos') teks += 'Barang telah dipos melalui J&T:\n' + baris + (h.track ? '\n\nTracking J&T: ' + h.track + '\nSemak status: ' + urlJejak(h.track, 'jnt').url : '') + '\n';
    else teks += 'Barang akan dihantar sendiri:\n' + baris + '\n';
    if (bk > 0) {
      teks += '\nBaki bayaran' + (ramai ? ' (semua dalam bungkusan ini)' : '') + ': ' + rm(bk) + '\n';
      if (data.bank) teks += data.bank.trim() + '\n';
    }
    teks += '\nSila maklumkan apabila barang telah diterima. Terima kasih.';
    bukaWa((its.find((it) => it.tel) || {}).tel || '', teks);
  }

  /* ---------- Untung rugi ---------- */

  let panelLukis = null;
  function bukaUntung() {
    panelLukis = paparUntung;
    paparUntung();
    buka($('dlgPanel'));
  }

  function paparUntung() {
    const jual = data.items.filter((it) => it.kat === 'jual');
    const selesai = jual.filter((it) => it.arkib);
    const belum = jual.filter((it) => !it.arkib);
    const t = pilihTahun(selesai, tetapan.untungTahun);
    const dlm = t.pilih === 'semua' ? selesai : selesai.filter((it) => tahunDari(it.arkib) === t.pilih);
    const jum = kiraUntung(dlm);
    const kelasU = (u) => (u < 0 ? 'rugi' : 'untung');
    const kotakKos = data.kotak.reduce((j, k) => j + (k.kos || 0), 0);
    const jnt = data.hantar.reduce((j, h) => j + (h.kos || 0), 0);
    const jadual = (tajuk, baris) => '<table class="jadual"><thead><tr><th>' + tajuk + '</th><th>Jual</th><th>Kos</th><th>Untung</th></tr></thead><tbody>' +
      baris.map((g) => '<tr><td><b>' + g.label + '</b><small>' + g.n + ' item' + (g.tak ? ' · ' + g.tak + ' tanpa kos' : '') + '</small></td><td>' + rm(g.jual) + '</td><td>' + rm(g.kos) +
        '</td><td class="' + kelasU(g.untung) + '">' + rm(g.untung) + '</td></tr>').join('') + '</tbody></table>';
    const ikut = (its, kunci, label) => {
      const m = new Map();
      its.forEach((it) => { const k = kunci(it); if (!m.has(k)) m.set(k, []); m.get(k).push(it); });
      return [...m.entries()].sort((a, b) => b[0] - a[0]).map(([k, x]) => Object.assign(kiraUntung(x), { label: label(k) }));
    };

    let html = '<h2>Untung rugi</h2><p class="nota">Untung dikira pada tarikh item selesai (diterima pelanggan dan masuk Arkib). Hanya item yang ada kos lengkap dikira.</p>';
    html += htmlCipTahun(t, 'data-untung-tahun');
    html += '<div class="wang3"><div><span>Jualan</span><b>' + rm(jum.jual) + '</b></div><div><span>Kos sebenar</span><b>' + rm(jum.kos) + '</b></div>' +
      '<div class="' + (jum.untung < 0 ? 'baki' : 'baki sifar') + '"><span>Untung</span><b>' + rm(jum.untung) + '</b></div></div>';
    if (t.pilih !== 'semua') {
      const bulan = ikut(dlm, (it) => new Date(it.arkib).getMonth(), (m) => BULAN[m] + ' ' + t.pilih);
      html += bulan.length ? '<h3>Ikut bulan · ' + t.pilih + '</h3>' + jadual('Bulan', bulan) : '<p class="nota">Tiada item selesai pada ' + t.pilih + '.</p>';
    }
    const tahunan = ikut(selesai, (it) => tahunDari(it.arkib), (y) => String(y));
    if (tahunan.length > 1 || t.pilih === 'semua') html += '<h3>Perbandingan tahunan</h3>' + (tahunan.length ? jadual('Tahun', tahunan) : '<p class="nota">Belum ada item selesai.</p>');

    if (belum.length) {
      const b = kiraUntung(belum);
      html += '<h3>Belum selesai (anggaran)</h3><p class="nota">' + b.n + ' item masih dalam proses dan belum dikira dalam untung di atas.' +
        (b.ada ? ' Anggaran untung ' + rm(b.untung) + ' daripada jualan ' + rm(b.jual) + ' (' + b.ada + ' item).' : '') +
        (b.tak ? ' ' + b.tak + ' item belum ada kos.' : '') + '</p>';
    }

    const tanpaKos = jual.filter((it) => !kosItem(it).lengkap);
    if (tanpaKos.length) {
      html += '<h3>' + tanpaKos.length + ' item belum ada kos</h3><p class="nota">Isi anggaran kos beli (RM, jumlah untuk semua unit) terus di sini, kemudian tekan Simpan kos. Ketuk nama item untuk buka butirannya.</p>';
      html += '<div class="senarai-kos">' + tanpaKos.sort(urut).map((it) => {
        const o = it.orderId ? cariOrder(it.orderId) : null;
        const sebab = !o ? 'Tiada order' : it.beli === null ? 'Harga beli belum diisi · ' + (o.no || 'order') : 'Kadar order belum diisi · ' + (o.no || 'order');
        return '<div class="baris-kos"><button type="button" class="isi" data-item="' + esc(it.id) + '"><b>' + esc(labelItem(it)) + '</b>' +
          '<small>' + esc(it.orang) + ' · jual ' + rm(it.harga) + ' · ' + esc(sebab) + (it.arkib ? ' · selesai ' + tarikh(it.arkib) : '') + '</small></button>' +
          '<label class="tag-beli"><span>Kos RM</span><input type="number" inputmode="decimal" min="0" step="0.01" data-kos-anggaran="' + esc(it.id) + '"></label></div>';
      }).join('') + '</div>' +
        '<button type="button" class="btn utama penuh-lebar" data-simpan-kos="1">Simpan kos</button>';
    }
    html += '<p class="nota">Jumlah kos posting BNS direkod: ' + rm(kotakKos) + ' · kos J&amp;T: ' + rm(jnt) + '</p>';
    html += '<div class="aksi-bawah"><button class="btn" type="button" data-tutup="1">Tutup</button></div>';
    $('panelIsi').innerHTML = html;
  }
  $('panelIsi').addEventListener('click', (e) => {
    if (e.target.closest('[data-tutup]')) { tutup($('dlgPanel')); return; }
    const ty = e.target.closest('[data-untung-tahun]');
    if (ty) {
      const v = ty.dataset.untungTahun;
      tetapan.untungTahun = v === 'semua' ? v : Number(v);
      simpanTetapan();
      paparUntung();
      return;
    }
    const o = e.target.closest('[data-order]');
    if (o) { bukaOrder(o.dataset.order); return; }
    if (e.target.closest('[data-simpan-kos]')) {
      const isi = [...$('panelIsi').querySelectorAll('[data-kos-anggaran]')].filter((x) => x.value !== '' && Number(x.value) >= 0);
      if (!isi.length) { toast('Isi kos sekurang-kurangnya satu item.'); return; }
      ubah(() => {
        isi.forEach((x) => {
          const it = cariItem(x.dataset.kosAnggaran);
          if (!it) return;
          // Kos RM terus (anggaran). Harga beli dari order diketepikan supaya anggaran ini yang diguna.
          it.modal = bulat(x.value);
          it.beli = null;
          it.anggaran = true;
        });
      }, isi.length + ' item dikemas kini dengan kos anggaran.');
      return;
    }
    const it = e.target.closest('[data-item]');
    if (it) bukaButir(it.dataset.item);
  });
  $('btnUntung').addEventListener('click', () => { tutup($('dlgMenu')); setTimeout(bukaUntung, 0); });
  $('btnSenaraiOrder').addEventListener('click', bukaSenaraiOrder);

  /* ---------- Sale akan datang ---------- */

  /*
    Senarai tarikh sale (contoh: drop baru di CM). Peringatan sebenar dibuat dalam
    Google Calendar (30 dan 15 minit sebelum), jadi telefon berbunyi walaupun apps ditutup.
  */
  const KAL = 'https://www.googleapis.com/calendar/v3/calendars/primary/events';
  const PERINGATAN = [30, 15];
  const cariSale = (id) => data.sale.find((s) => s.id === id);
  const labelSale = (s) => (s.jenis ? s.jenis + ' ' : '') + s.nama;
  const saleAkanDatang = () => data.sale.filter((s) => s.t > Date.now() - 3600000).sort((a, b) => a.t - b.t);

  function paparBannerSale() {
    const s = saleAkanDatang()[0];
    const el = $('bannerSale');
    const tunjuk = !!s && s.t - Date.now() < 86400000;
    el.hidden = !tunjuk;
    if (!tunjuk) return;
    const baki = bakiMasa(s.t);
    el.querySelector('b').textContent = baki ? 'Sale dalam ' + baki : 'Sale sedang berlangsung';
    el.querySelector('span').textContent = labelSale(s) + ' · ' + masaZon(s.t, 'MY', true);
  }

  function bukaSale() {
    panelLukis = paparSale;
    paparSale();
    buka($('dlgPanel'));
    muatGis().catch(() => {});
  }

  function htmlSale(s, lepas) {
    const baki = bakiMasa(s.t);
    return '<div class="sale-kad' + (lepas ? ' lepas' : '') + '">' +
      '<div class="sale-atas"><b>' + (s.jenis ? '<span class="jenis">' + esc(s.jenis) + '</span>' : '') + esc(s.nama) + '</b>' +
      (lepas ? '' : '<span class="pil ' + (s.t - Date.now() < 86400000 ? 'st-belum' : 'st-aku') + '">' + (baki ? esc(baki) : 'Sedang berlangsung') + '</span>') + '</div>' +
      '<small>' + esc(masaZon(s.t, 'MY')) + (s.zon !== 'MY' ? ' · ' + esc(masaZon(s.t, s.zon, true)) + ' ' + ZON[s.zon].pendek : '') + '</small>' +
      (s.catatan ? '<div class="kad-catatan">' + esc(s.catatan) + '</div>' : '') +
      '<div class="baris-btn">' +
      (lepas ? '' : '<button type="button" class="btn kecil' + (s.eventId ? '' : ' utama') + '" data-sale-kal="' + esc(s.id) + '">' + (s.eventId ? '✓ Dalam kalendar' : 'Tambah ke kalendar') + '</button>') +
      '<button type="button" class="btn kecil" data-sale-tempah="' + esc(s.id) + '">Buat tempahan</button>' +
      (s.pautan ? '<a class="btn kecil" href="' + esc(s.pautan) + '" target="_blank" rel="noopener">Buka ↗</a>' : '') +
      '<button type="button" class="btn kecil" data-sale-edit="' + esc(s.id) + '">Edit</button>' +
      '</div></div>';
  }

  function paparSale() {
    const datang = saleAkanDatang();
    const lepas = data.sale.filter((s) => s.t <= Date.now() - 3600000).sort((a, b) => b.t - a.t).slice(0, 10);
    let html = '<h2>Sale akan datang</h2><p class="nota">Masa dalam waktu Malaysia. Tambah ke Google Calendar untuk peringatan ' + PERINGATAN.join(' dan ') + ' minit sebelum sale.</p>' +
      '<button type="button" class="btn utama penuh-lebar" data-sale-baru="1">+ Sale baru</button>';
    html += datang.length ? datang.map((s) => htmlSale(s)).join('') : '<p class="kosong">Tiada sale akan datang.</p>';
    if (lepas.length) html += '<details class="sale-lepas"><summary>Sale lepas (' + lepas.length + ')</summary>' + lepas.map((s) => htmlSale(s, true)).join('') + '</details>';
    html += '<div class="aksi-bawah"><button class="btn" type="button" data-tutup="1">Tutup</button></div>';
    $('panelIsi').innerHTML = html;
  }

  function borangSale(s) {
    const baru = !s;
    const zon = s ? s.zon : (tetapan.zonSale || 'PT');
    const b = s ? bahagianZon(s.t, ZON[zon].tz) : null;
    borang({
      tajuk: baru ? 'Sale baru' : 'Edit sale',
      html: '<div class="dua"><label class="medan kecil">Jenis<input name="jenis" list="senaraiJenis" maxlength="20" placeholder="RLC" value="' + esc(s ? s.jenis : '') + '"></label>' +
        '<label class="medan">Item / sale<input name="nama" maxlength="120" data-fokus placeholder="Contoh: RLC Nissan Skyline" value="' + esc(s ? s.nama : '') + '"></label></div>' +
        '<div class="dua"><label class="medan">Tarikh<input name="tarikh" type="date" value="' + (b ? b.y + '-' + dua(b.mo) + '-' + dua(b.d) : tarikhInput()) + '"></label>' +
        '<label class="medan">Masa<input name="masa" type="time" value="' + (b ? dua(b.h) + ':' + dua(b.mi) : '') + '"></label></div>' +
        '<label class="medan">Zon waktu<select name="zon">' + Object.keys(ZON).map((k) => '<option value="' + k + '"' + (k === zon ? ' selected' : '') + '>' + ZON[k].label + '</option>').join('') + '</select></label>' +
        '<p class="nota" id="saleMY"></p>' +
        medanTeks('pautan', 'Pautan <small>(pilihan)</small>', s ? s.pautan : '', ' type="url" inputmode="url" placeholder="https://…"') +
        medanTeks('catatan', 'Catatan <small>(pilihan)</small>', s ? s.catatan : '', ' maxlength="500"') +
        '<label class="tanda"><input type="checkbox" name="kal" checked> ' + (s && s.eventId ? 'Kemas kini dalam Google Calendar' : 'Tambah ke Google Calendar (peringatan ' + PERINGATAN.join(' dan ') + ' minit sebelum)') + '</label>' +
        (baru ? '' : '<div class="baris-btn"><button type="button" class="btn bahaya kecil" data-padam-sale="1">Padam sale</button></div>'),
      lepas: (f) => {
        const kira = () => {
          const t = masaBorang(f);
          $('saleMY').textContent = t && f.zon.value !== 'MY' ? 'Waktu Malaysia: ' + masaZon(t, 'MY') : '';
        };
        ['tarikh', 'masa', 'zon'].forEach((n) => { f[n].addEventListener('input', kira); f[n].addEventListener('change', kira); });
        kira();
        const pd = f.querySelector('[data-padam-sale]');
        if (pd) pd.addEventListener('click', () => padamSale(s));
      },
      hantar(f) {
        const nama = f.nama.value.trim();
        if (!nama) return 'Isi nama item atau sale.';
        const t = masaBorang(f);
        if (!t) return 'Isi tarikh dan masa sale.';
        const pautan = f.pautan.value.trim();
        if (pautan && !/^https?:\/\//.test(pautan)) return 'Pautan mesti bermula dengan https://';
        tetapan.zonSale = f.zon.value;
        simpanTetapan();
        const x = bersihSale(Object.assign({}, s || {}, { jenis: f.jenis.value.trim(), nama, t, zon: f.zon.value, pautan, catatan: f.catatan.value.trim() }));
        ubah(() => {
          const i = data.sale.findIndex((y) => y.id === x.id);
          if (i >= 0) data.sale[i] = x; else data.sale.push(x);
        }, baru ? 'Sale disimpan.' : 'Sale dikemas kini.');
        if (f.kal.checked && x.t > Date.now()) kalendarSale(x.id);
        return '';
      },
    });
  }
  function masaBorang(f) {
    const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(f.tarikh.value);
    const m = /^(\d{2}):(\d{2})/.exec(f.masa.value);
    if (!d || !m) return 0;
    return keUtc(+d[1], +d[2], +d[3], +m[1], +m[2], ZON[f.zon.value].tz);
  }

  async function padamSale(s) {
    const ok = await sahkan({ tajuk: 'Padam sale?', teks: labelSale(s) + (s.eventId ? '\nAcara dalam Google Calendar juga akan dipadam.' : ''), ya: 'Padam' });
    if (!ok) return;
    tutup($('dlgForm'));
    if (s.eventId) {
      try { await pastiKalendar(); await gfetch(KAL + '/' + encodeURIComponent(s.eventId), { method: 'DELETE' }); }
      catch (e) { if (![404, 410].includes(e.kod)) toast('Sale dipadam, tetapi acara dalam Google Calendar perlu dipadam sendiri.'); }
    }
    ubah(() => { data.sale = data.sale.filter((y) => y.id !== s.id); }, 'Sale dipadam.');
  }

  async function pastiKalendar() {
    if (tokenSah(120000) && selaras.kal) return;
    await mintaToken(SKOP + ' ' + SKOP_KAL);
    simpanSelaras();
    if (!selaras.kal) throw ralatSelaras('kal_tolak');
  }
  const isoKal = (ms) => new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  function pautanKalendar(s) {
    return 'https://calendar.google.com/calendar/render?action=TEMPLATE&text=' + encodeURIComponent('Sale: ' + labelSale(s)) +
      '&dates=' + isoKal(s.t) + '/' + isoKal(s.t + 1800000) + '&details=' + encodeURIComponent([s.pautan, s.catatan].filter(Boolean).join('\n'));
  }

  // Tambah atau kemas kini acara Google Calendar untuk sale, dengan peringatan 30 dan 15 minit.
  async function kalendarSale(id, senyap) {
    let s = cariSale(id);
    if (!s) return;
    const badan = JSON.stringify({
      summary: 'Sale: ' + labelSale(s),
      description: [s.pautan, s.catatan, 'Dari apps Diecast'].filter(Boolean).join('\n'),
      start: { dateTime: new Date(s.t).toISOString() },
      end: { dateTime: new Date(s.t + 1800000).toISOString() },
      reminders: { useDefault: false, overrides: PERINGATAN.map((m) => ({ method: 'popup', minutes: m })) },
    });
    const opt = (method) => ({ method, headers: { 'Content-Type': 'application/json' }, body: badan });
    try {
      await pastiKalendar();
      let j = null;
      if (s.eventId) {
        try { j = await (await gfetch(KAL + '/' + encodeURIComponent(s.eventId), opt('PATCH'))).json(); }
        catch (e) { if (![404, 410].includes(e.kod)) throw e; }
      }
      if (!j) j = await (await gfetch(KAL, opt('POST'))).json();
      s = cariSale(id);
      if (!s) return;
      s.eventId = j.id || '';
      simpan();
      segarSemua();
      if (!senyap) toast('Ditambah ke Google Calendar. Peringatan ' + PERINGATAN.join(' dan ') + ' minit sebelum sale.');
    } catch (e) {
      if (senyap) throw e;
      const sebab = e.kod === 'popup_closed' || e.kod === 'access_denied' || e.kod === 'kal_tolak' ? 'Kebenaran Google Calendar tidak diberi.'
        : e.kod === 403 ? 'Google Calendar API belum diaktifkan dalam projek Google Cloud anda.'
          : 'Tidak dapat sambung ke Google Calendar.';
      const p = await tanya({
        tajuk: 'Tidak dapat tambah ke kalendar',
        teks: sebab + '\nBuka Google Calendar dan simpan sendiri? Peringatan akan ikut tetapan lalai kalendar anda.',
        butang: [{ nilai: 'batal', label: 'Tutup' }, { nilai: 'buka', label: 'Buka Google Calendar', kelas: 'utama' }],
      });
      if (p === 'buka') window.open(pautanKalendar(cariSale(id) || s), '_blank', 'noopener');
    }
  }

  /* Sale untuk tempahan yang belum dibeli: RLC Selasa, Elite / MB Khamis, 9 pagi PT. */
  const HARI_SALE = [{ re: /^RLC\b/, hari: 2 }, { re: /^(ELITE|MB|MATCHBOX)\b/, hari: 4 }];
  const JENIS_SALE = ['RLC', 'ELITE', 'MB'];
  const kunciItem = (it) => kunciOrang((it.jenis || '') + ' ' + it.nama);
  function saleUntuk(it) {
    const k = kunciItem(it);
    return data.sale.filter((s) => s.kunci === k && s.t > Date.now() - 2 * 86400000).sort((a, b) => a.t - b.t)[0] || null;
  }
  const itemTanpaSale = () => itemTab('beli').filter((it) => !it.orderId && !saleUntuk(it));
  function hariSale(jenis) {
    const j = kunciOrang(jenis);
    const x = HARI_SALE.find((h) => h.re.test(j));
    return x ? x.hari : null;
  }
  // Hari minggu (0 = Ahad) seterusnya, 9:00 pagi PT, yang belum berlalu. Pulangkan tarikh PT 'YYYY-MM-DD'.
  function tarikhSaleSeterusnya(hari) {
    const tz = ZON.PT.tz;
    const b = bahagianZon(Date.now(), tz);
    for (let d = 0; d < 8; d++) {
      const c = new Date(Date.UTC(b.y, b.mo - 1, b.d + d));
      if (c.getUTCDay() !== hari) continue;
      const t = keUtc(c.getUTCFullYear(), c.getUTCMonth() + 1, c.getUTCDate(), 9, 0, tz);
      if (t > Date.now()) return c.getUTCFullYear() + '-' + dua(c.getUTCMonth() + 1) + '-' + dua(c.getUTCDate());
    }
    return '';
  }

  function borangSaleTempahan() {
    const kump = new Map();
    itemTanpaSale().sort(urut).forEach((it) => {
      const k = kunciItem(it);
      if (!kump.has(k)) kump.set(k, { k, jenis: it.jenis, nama: it.nama, items: [] });
      kump.get(k).items.push(it);
    });
    const g = [...kump.values()];
    if (!g.length) { toast('Semua tempahan yang belum dibeli sudah ada sale.'); return; }
    const pilihanJenis = (v) => '<select data-jenis-sale>' + ['', ...JENIS_SALE, 'LAIN'].map((j) =>
      '<option value="' + j + '"' + (j === v ? ' selected' : '') + '>' + (j === '' ? 'Pilih jenis' : j === 'LAIN' ? 'Lain-lain' : j) + '</option>').join('') + '</select>';
    borang({
      tajuk: 'Sale untuk tempahan',
      nota: 'RLC: Selasa, Elite / MB: Khamis, 9:00 pagi waktu US (PT). Jenis lain: isi tarikh sendiri. Tarikh dan masa boleh diubah. Waktu Malaysia ditunjuk di bawah setiap item.',
      html: '<div class="senarai-sale">' + g.map((x, i) => {
        const hari = hariSale(x.jenis);
        const tarikhAwal = hari === null ? '' : tarikhSaleSeterusnya(hari);
        const orang = [...new Set(x.items.map((it) => it.orang))].join(', ');
        return '<div class="baris-sale" data-i="' + i + '">' +
          '<label class="tanda"><input type="checkbox" name="pilih" value="' + i + '"' + (tarikhAwal ? ' checked' : '') + '> <span><b>' + esc(labelItem(x.items[0])) + '</b>' +
          '<small>' + x.items.length + ' tempahan · ' + esc(orang) + '</small></span></label>' +
          (x.jenis ? '' : '<label class="medan kecil">Jenis' + pilihanJenis('') + '</label>') +
          '<div class="dua"><label class="medan">Tarikh (PT)<input type="date" data-tarikh value="' + tarikhAwal + '"></label>' +
          '<label class="medan">Masa (PT)<input type="time" data-masa value="09:00"></label></div>' +
          '<p class="nota" data-my></p></div>';
      }).join('') + '</div>' +
        '<label class="tanda"><input type="checkbox" name="kal" checked> Tambah ke Google Calendar (peringatan ' + PERINGATAN.join(' dan ') + ' minit sebelum)</label>',
      simpan: 'Simpan sale',
      lepas: (f) => {
        const masaBaris = (row) => {
          const d = /^(\d{4})-(\d{2})-(\d{2})$/.exec(row.querySelector('[data-tarikh]').value);
          const m = /^(\d{2}):(\d{2})/.exec(row.querySelector('[data-masa]').value);
          return d && m ? keUtc(+d[1], +d[2], +d[3], +m[1], +m[2], ZON.PT.tz) : 0;
        };
        const kira = (row) => {
          const t = masaBaris(row);
          row.querySelector('[data-my]').textContent = t ? 'Waktu Malaysia: ' + masaZon(t, 'MY') + (t < Date.now() ? ' (sudah berlalu)' : '') : 'Pilih tarikh sale.';
        };
        f.querySelectorAll('.baris-sale').forEach((row) => {
          kira(row);
          row.addEventListener('input', (e) => {
            if (e.target.matches('[data-jenis-sale]')) {
              const h = hariSale(e.target.value);
              if (h !== null) row.querySelector('[data-tarikh]').value = tarikhSaleSeterusnya(h);
            }
            // Bila tarikh diisi, item ditanda sendiri.
            if (!e.target.matches('[name=pilih]') && masaBaris(row)) row.querySelector('[name=pilih]').checked = true;
            kira(row);
          });
          row.addEventListener('change', () => kira(row));
        });
        f._masaBaris = masaBaris;
      },
      hantar(f) {
        const rows = [...f.querySelectorAll('.baris-sale')].filter((row) => row.querySelector('[name=pilih]').checked);
        if (!rows.length) return 'Tanda sekurang-kurangnya satu item.';
        const baru = [];
        for (const row of rows) {
          const x = g[+row.dataset.i];
          const t = f._masaBaris(row);
          if (!t) return 'Isi tarikh dan masa sale untuk ' + labelItem(x.items[0]) + '.';
          const js = row.querySelector('[data-jenis-sale]');
          baru.push({ x, t, jenis: js && js.value && js.value !== 'LAIN' ? js.value : '' });
        }
        const ids = [];
        ubah(() => {
          baru.forEach(({ x, t, jenis }) => {
            // Jenis yang dipilih disimpan pada tempahan supaya lain kali tak perlu pilih lagi.
            if (jenis) x.items.forEach((it) => { const y = cariItem(it.id); if (y) y.jenis = jenis; });
            const sl = bersihSale({ jenis: jenis || x.jenis, nama: x.nama, t, zon: 'PT' });
            data.sale.push(sl);
            ids.push(sl.id);
          });
        }, baru.length + ' sale disimpan.');
        if (f.kal.checked) kalendarBanyak(ids.filter((id) => cariSale(id).t > Date.now()));
        return '';
      },
    });
  }

  async function kalendarBanyak(ids) {
    if (!ids.length) return;
    let n = 0;
    try {
      for (const id of ids) { await kalendarSale(id, true); n++; }
      toast((n === 1 ? 'Sale' : n + ' sale') + ' ditambah ke Google Calendar. Peringatan ' + PERINGATAN.join(' dan ') + ' minit sebelum sale.');
    } catch (e) {
      const sebab = e.kod === 'popup_closed' || e.kod === 'access_denied' || e.kod === 'kal_tolak' ? 'Kebenaran Google Calendar tidak diberi.'
        : e.kod === 403 ? 'Google Calendar API belum diaktifkan dalam projek Google Cloud anda.'
          : 'Tidak dapat sambung ke Google Calendar.';
      toast(sebab + ' Sale disimpan dalam apps; tambah ke kalendar kemudian dari Sale akan datang.');
    }
  }

  $('panelIsi').addEventListener('click', (e) => {
    const t = (n) => e.target.closest('[data-' + n + ']');
    if (t('sale-baru')) borangSale(null);
    else if (t('sale-edit')) { const s = cariSale(t('sale-edit').dataset.saleEdit); if (s) borangSale(s); }
    else if (t('sale-kal')) kalendarSale(t('sale-kal').dataset.saleKal);
    else if (t('sale-tempah')) {
      const s = cariSale(t('sale-tempah').dataset.saleTempah);
      if (s) borangTempahan({ jenis: s.jenis, nama: s.nama });
    }
  });
  $('btnSale').addEventListener('click', () => { tutup($('dlgMenu')); setTimeout(bukaSale, 0); });
  $('bannerSale').addEventListener('click', bukaSale);
  setInterval(() => {
    paparBannerSale();
    if ($('dlgPanel').open && panelLukis === paparSale) paparSale();
  }, 60000);

  /* ---------- Tetapan ---------- */

  $('btnMenu').addEventListener('click', () => {
    $('tetBank').value = data.bank || '';
    $('tetMarkup').value = data.markup || '';
    gunaTema();
    paparTetapanSelaras();
    paparStoran();
    if (selaras.aktif) muatGis().catch(() => {});
    buka($('dlgMenu'));
  });
  $('menuTutup').addEventListener('click', () => tutup($('dlgMenu')));
  $('segTema').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-tema]');
    if (!b) return;
    tetapan.tema = b.dataset.tema;
    simpanTetapan();
    gunaTema();
  });
  $('tetMarkup').addEventListener('change', (e) => {
    const n = Math.min(10, Math.max(0, Number(e.target.value) || 0));
    data.markup = Math.round(n * 100) / 100;
    e.target.value = data.markup || '';
    simpan();
    toast(data.markup ? 'Kadar pasaran akan ditambah ' + data.markup + '% untuk order baru.' : 'Caj kad dibuang.');
  });
  $('tetBank').addEventListener('change', (e) => {
    data.bank = e.target.value.trim();
    simpan();
    toast('Maklumat bayaran disimpan.');
  });

  /* ---------- Simpan salinan dan import ---------- */

  $('btnEksport').addEventListener('click', async () => {
    // Gambar dalam peranti disertakan supaya salinan lengkap.
    const gambar = {};
    for (const h of new Set(data.items.map((it) => hashGambar(it.gambar)).filter(Boolean))) {
      try { const b = await bacaBlob(h); if (b) gambar[h] = await blobKeData(b); } catch (e) { /* abai */ }
    }
    const isi = JSON.stringify(Object.assign({ disimpan: Date.now() }, eksportData(), Object.keys(gambar).length ? { gambar } : {}), null, 1);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([isi], { type: 'application/json' }));
    a.download = 'diecast-salinan-' + tarikhInput() + '.json';
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    toast('Salinan disimpan.');
  });

  const pilihFail = () => { $('failImport').value = ''; $('failImport').click(); };
  $('btnImport').addEventListener('click', pilihFail);
  $('btnImportMula').addEventListener('click', pilihFail);

  $('failImport').addEventListener('change', async (e) => {
    const fail = e.target.files && e.target.files[0];
    if (!fail) return;
    let j;
    try { j = JSON.parse(await fail.text()); } catch (err) { toast('Fail ini bukan fail Diecast.'); return; }
    if (!j || !Array.isArray(j.items)) { toast('Fail ini bukan fail Diecast.'); return; }
    const baru = bersihData(j);
    if (j.gambar && typeof j.gambar === 'object') {
      for (const [h, d] of Object.entries(j.gambar)) {
        if (!/^[0-9a-f]+$/.test(h) || !/^data:image\//.test(String(d))) continue;
        try { await simpanBlob(await dataKeBlob(d), h); } catch (e) { /* abai */ }
      }
    }
    let cara = 'ganti';
    if (data.items.length) {
      cara = await tanya({
        tajuk: 'Import ' + baru.items.length + ' item',
        teks: 'Ganti: data sekarang (' + data.items.length + ' item) dibuang dan diganti dengan fail ini.\nGabung: rekod dalam fail ditambah; rekod yang sama dikemas kini.',
        butang: [{ nilai: 'batal', label: 'Batal' }, { nilai: 'gabung', label: 'Gabung' }, { nilai: 'ganti', label: 'Ganti', kelas: 'utama' }],
      });
      if (!cara) return;
    }
    if (cara === 'ganti') {
      data = Object.assign(baru, { bank: baru.bank || data.bank, kadar: baru.kadar || data.kadar });
    } else {
      ['items', 'orders', 'kotak', 'hantar', 'sale'].forEach((kunci) => {
        baru[kunci].forEach((x) => {
          const i = data[kunci].findIndex((y) => y.id === x.id);
          if (i >= 0) data[kunci][i] = x; else data[kunci].push(x);
        });
      });
      if (!data.bank && baru.bank) data.bank = baru.bank;
    }
    simpan();
    if ($('dlgMenu').open) tutup($('dlgMenu'));
    papar();
    toast(baru.items.length + ' item dimasukkan.');
  });

  /* ---------- Selaras melalui Google Drive ---------- */

  /*
    Data disimpan sebagai satu fail (diecast.json) dalam folder data apps dalam
    Google Drive pengguna (appDataFolder), yang hanya apps ini boleh baca.
    Peraturan: perubahan terakhir menang. "asas" ialah masa versi yang terakhir
    diselaras; ia menentukan pihak mana yang berubah sejak itu.
  */
  const KUNCI_SELARAS = 'diecast-selaras';
  const NAMA_FAIL = 'diecast.json';
  const SKOP = 'https://www.googleapis.com/auth/drive.appdata';
  const SKOP_KAL = 'https://www.googleapis.com/auth/calendar.events';
  const DRIVE = 'https://www.googleapis.com/drive/v3';
  const MUAT_NAIK = 'https://www.googleapis.com/upload/drive/v3/files';

  let selaras = { aktif: false, fid: null, asas: null, emel: null, masa: null, tok: null, exp: 0 };
  let statusSelaras = 'mati'; // mati | ok | jalan | perlu | gagal

  function muatSelaras() {
    try {
      const j = JSON.parse(localStorage.getItem(KUNCI_SELARAS) || '{}');
      if (j && typeof j === 'object') selaras = Object.assign(selaras, j);
    } catch (e) { /* guna lalai */ }
  }
  function simpanSelaras() {
    try { localStorage.setItem(KUNCI_SELARAS, JSON.stringify(selaras)); } catch (e) { /* tak penting */ }
  }

  const tokenSah = (ruang) => !!(selaras.tok && selaras.exp > Date.now() + (ruang || 60000));
  const ralatSelaras = (kod) => Object.assign(new Error(String(kod)), { kod });

  function masaPendek(ms) {
    if (!ms) return '-';
    const d = new Date(ms);
    return tarikh(ms) + ', ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
  }

  const LABEL_STATUS = { ok: 'Diselaras', jalan: 'Sedang selaras', perlu: 'Ketik untuk selaras', gagal: 'Gagal selaras' };

  function setStatus(s) {
    statusSelaras = s;
    const b = $('btnSelaras');
    b.hidden = s === 'mati';
    b.className = 'selaras s-' + s;
    const label = LABEL_STATUS[s] || '';
    b.setAttribute('aria-label', label);
    b.title = label;
    $('selarasTeks').textContent = '';
    if ($('dlgMenu').open) paparTetapanSelaras();
  }

  let gisJanji = null;
  function muatGis() {
    if (window.google && google.accounts && google.accounts.oauth2) return Promise.resolve();
    if (!gisJanji) {
      gisJanji = new Promise((ok, gagal) => {
        const s = document.createElement('script');
        s.src = 'https://accounts.google.com/gsi/client';
        s.async = true;
        s.onload = () => ok();
        s.onerror = () => { gisJanji = null; gagal(ralatSelaras('gis')); };
        document.head.appendChild(s);
      });
    }
    return gisJanji;
  }

  // Minta token Google. Mesti dipanggil daripada ketukan pengguna (tetingkap Google dibuka).
  let klienToken = null;
  function mintaToken(skop) {
    return muatGis().then(() => new Promise((ok, gagal) => {
      const id = (window.DIECAST_CONFIG || {}).CLIENT_ID;
      if (!id) { gagal(ralatSelaras('cfg')); return; }
      if (!klienToken) klienToken = google.accounts.oauth2.initTokenClient({ client_id: id, scope: SKOP, callback: () => {} });
      klienToken.callback = (r) => {
        if (!r || r.error) { gagal(ralatSelaras((r && r.error) || 'token')); return; }
        selaras.tok = r.access_token;
        selaras.exp = Date.now() + (Number(r.expires_in) || 3600) * 1000;
        selaras.kal = String(r.scope || '').split(' ').includes(SKOP_KAL);
        simpanSelaras();
        ok();
      };
      klienToken.error_callback = (e) => gagal(ralatSelaras((e && e.type) || 'popup'));
      const o = { prompt: '' };
      if (skop) o.scope = skop;
      if (selaras.emel) o.hint = selaras.emel;
      klienToken.requestAccessToken(o);
    }));
  }

  async function gfetch(url, opt) {
    if (!tokenSah()) throw ralatSelaras('auth');
    opt = opt || {};
    const r = await fetch(url, Object.assign({}, opt, {
      headers: Object.assign({}, opt.headers || {}, { Authorization: 'Bearer ' + selaras.tok }),
    }));
    if (r.status === 401) { selaras.tok = null; selaras.exp = 0; simpanSelaras(); throw ralatSelaras('auth'); }
    if (!r.ok) throw ralatSelaras(r.status);
    return r;
  }

  async function cariFail() {
    if (selaras.fid) return selaras.fid;
    const q = encodeURIComponent("name='" + NAMA_FAIL + "'");
    const j = await (await gfetch(DRIVE + '/files?spaces=appDataFolder&fields=files(id)&q=' + q)).json();
    selaras.fid = j.files && j.files[0] ? j.files[0].id : null;
    simpanSelaras();
    return selaras.fid;
  }

  // undefined = tiada fail; null = fail ada tapi tak boleh dibaca
  async function bacaJauh() {
    const fid = await cariFail();
    if (!fid) return undefined;
    try {
      const j = await (await gfetch(DRIVE + '/files/' + fid + '?alt=media')).json();
      return j && Array.isArray(j.items) ? j : null;
    } catch (e) {
      if (e.kod === 404) { selaras.fid = null; simpanSelaras(); return undefined; }
      if (e instanceof SyntaxError) return null;
      throw e;
    }
  }

  const isiFail = () => JSON.stringify(eksportData());

  async function tulisJauh() {
    if (selaras.fid) {
      try {
        await gfetch(MUAT_NAIK + '/' + selaras.fid + '?uploadType=media', {
          method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: isiFail(),
        });
        selaras.asas = data.diubah;
        return;
      } catch (e) {
        if (e.kod !== 404) throw e;
        selaras.fid = null;
      }
    }
    const b = 'diecast' + Date.now();
    const badan = '--' + b + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n' +
      JSON.stringify({ name: NAMA_FAIL, parents: ['appDataFolder'] }) +
      '\r\n--' + b + '\r\nContent-Type: application/json\r\n\r\n' + isiFail() + '\r\n--' + b + '--';
    const j = await (await gfetch(MUAT_NAIK + '?uploadType=multipart&fields=id', {
      method: 'POST', headers: { 'Content-Type': 'multipart/related; boundary=' + b }, body: badan,
    })).json();
    selaras.fid = j.id;
    selaras.asas = data.diubah;
  }

  // Gambar: satu fail g-<cincang>.jpg bagi setiap gambar dalam folder apps. Muat naik yang
  // belum ada di Drive, muat turun yang belum ada dalam peranti. Hanya gambar yang dirujuk item.
  async function selarasGambar() {
    const perlu = [...new Set(data.items.map((it) => hashGambar(it.gambar)).filter(Boolean))];
    if (!perlu.length) return;
    const jauh = new Map();
    let halaman = '';
    do {
      const j = await (await gfetch(DRIVE + '/files?spaces=appDataFolder&pageSize=1000&fields=nextPageToken,files(id,name)' +
        (halaman ? '&pageToken=' + encodeURIComponent(halaman) : ''))).json();
      (j.files || []).forEach((f) => { const m = /^g-([0-9a-f]+)\.jpg$/.exec(f.name || ''); if (m) jauh.set(m[1], f.id); });
      halaman = j.nextPageToken || '';
    } while (halaman);
    let baru = 0;
    for (const h of perlu) {
      if (urlGambar.has(h) && !jauh.has(h)) {
        const blob = await bacaBlob(h);
        if (!blob) continue;
        const b = 'diecastg' + Date.now();
        const badan = new Blob(['--' + b + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n' +
          JSON.stringify({ name: 'g-' + h + '.jpg', parents: ['appDataFolder'] }) +
          '\r\n--' + b + '\r\nContent-Type: ' + (blob.type || 'image/jpeg') + '\r\n\r\n', blob, '\r\n--' + b + '--']);
        await gfetch(MUAT_NAIK + '?uploadType=multipart&fields=id', { method: 'POST', headers: { 'Content-Type': 'multipart/related; boundary=' + b }, body: badan });
      } else if (!urlGambar.has(h) && jauh.has(h)) {
        const blob = await (await gfetch(DRIVE + '/files/' + jauh.get(h) + '?alt=media')).blob();
        await simpanBlob(blob, h);
        baru++;
      }
    }
    if (baru) { papar(); if ($('dlgButir').open) paparButir(); }
  }

  function gunaJauh(jauh, mesej) {
    data = bersihData(jauh);
    simpan({ kekal: true });
    selaras.asas = data.diubah;
    segarSemua();
    if (mesej) toast(mesej);
  }

  async function langkahSelaras() {
    if (!tokenSah()) { setStatus('perlu'); return null; }
    setStatus('jalan');
    let hasil = 'sama';
    try {
      const jauh = await bacaJauh();
      const adaLokal = data.items.length > 0;
      if (!jauh) {
        if (adaLokal) { await tulisJauh(); hasil = 'hantar'; }
      } else if (!adaLokal && selaras.asas == null) {
        gunaJauh(jauh, 'Data dari Google Drive dimuatkan.');
        hasil = 'muat';
      } else {
        const r = Number(jauh.diubah) || 0;
        const l = Number(data.diubah) || 0;
        const a = selaras.asas;
        if (r === l) {
          selaras.asas = r;
        } else if (a === null || a === undefined) {
          const p = await tanya({
            tajuk: 'Data berbeza',
            teks: 'Data dalam Google Drive (diubah ' + masaPendek(r) + ') tidak sama dengan data dalam peranti ini (diubah ' + masaPendek(l) + '). Guna yang mana?',
            butang: [{ nilai: 'b', label: 'Peranti ini' }, { nilai: 'a', label: 'Google Drive', kelas: 'utama' }],
          });
          if (p === 'a') { gunaJauh(jauh, 'Data dari Google Drive dimuatkan.'); hasil = 'muat'; }
          else if (p === 'b') { await tulisJauh(); hasil = 'hantar'; }
          else { setStatus('perlu'); return null; }
        } else {
          const lokalUbah = l > a;
          const jauhUbah = r > a;
          if (jauhUbah && (!lokalUbah || r > l)) { gunaJauh(jauh, lokalUbah ? 'Perubahan dari peranti lain lebih baru dan digunakan.' : null); hasil = 'muat'; }
          else { await tulisJauh(); hasil = 'hantar'; }
        }
      }
      if (hasil === 'muat') await pindahGambar();
      try { await siapGambar; await selarasGambar(); } catch (e) { if (e.kod === 'auth') throw e; }
      selaras.masa = Date.now();
      simpanSelaras();
      setStatus('ok');
      return hasil;
    } catch (e) {
      simpanSelaras();
      setStatus(e.kod === 'auth' ? 'perlu' : 'gagal');
      return null;
    }
  }

  let selarasJalan = null;
  let selarasLagi = false;
  function selaraskan() {
    if (!selaras.aktif) return Promise.resolve();
    if (selarasJalan) { selarasLagi = true; return selarasJalan; }
    selarasJalan = langkahSelaras().finally(() => {
      selarasJalan = null;
      if (selarasLagi) { selarasLagi = false; selaraskan(); }
    });
    return selarasJalan;
  }

  let selarasMasa = null;
  function jadualSelaras() {
    if (!selaras.aktif) return;
    clearTimeout(selarasMasa);
    if (!tokenSah()) { setStatus('perlu'); return; }
    selarasMasa = setTimeout(selaraskan, 2000);
  }

  async function logMasuk() {
    try {
      await mintaToken();
    } catch (e) {
      toast(e.kod === 'popup_closed' || e.kod === 'access_denied' ? 'Sambungan dibatalkan.' : 'Tidak dapat sambung ke Google. Cuba lagi.');
      setStatus(selaras.aktif ? 'perlu' : 'mati');
      return false;
    }
    return true;
  }

  async function ambilEmel() {
    try {
      const j = await (await gfetch(DRIVE + '/about?fields=user(emailAddress)')).json();
      if (j && j.user && j.user.emailAddress) { selaras.emel = j.user.emailAddress; simpanSelaras(); }
    } catch (e) { /* tak penting */ }
  }

  function paparTetapanSelaras() {
    const hidup = selaras.aktif;
    $('selarasNota').textContent = !hidup
      ? 'Belum log masuk. Log masuk dengan akaun Google yang sama di telefon dan PC untuk menggunakan data yang sama. Data disimpan dalam folder tersembunyi khas apps ini dalam Google Drive anda; pihak lain (termasuk apps lain) tidak boleh membacanya.'
      : 'Log masuk' + (selaras.emel ? ' sebagai ' + selaras.emel : '') + '. Data diselaras sendiri selepas setiap perubahan.';
    $('btnSambung').hidden = hidup;
    $('btnSelarasKini').hidden = !hidup;
    $('btnPutus').hidden = !hidup;
    $('selarasMasa').textContent = !hidup ? '' : statusSelaras === 'jalan' ? 'Sedang selaras…'
      : selaras.masa ? 'Terakhir diselaras ' + masaPendek(selaras.masa) : 'Belum pernah diselaras.';
  }

  async function sambungDrive() {
    if (!(await logMasuk())) return;
    selaras.aktif = true;
    selaras.asas = null;
    simpanSelaras();
    if ($('dlgMenu').open) tutup($('dlgMenu'));
    await ambilEmel();
    const hasil = await selaraskan();
    if (hasil === 'hantar' || hasil === 'sama') toast('Log masuk' + (selaras.emel ? ' sebagai ' + selaras.emel : '') + '. Data diselaras.');
    papar();
  }
  $('btnSambungBanner').addEventListener('click', sambungDrive);
  $('btnTutupBanner').addEventListener('click', () => { tetapan.tutupBanner = true; simpanTetapan(); papar(); });
  $('btnSambung').addEventListener('click', sambungDrive);
  $('btnSambungMula').addEventListener('click', sambungDrive);

  async function selarasKetuk() {
    if (!tokenSah() && !(await logMasuk())) return;
    selaraskan();
  }
  $('btnSelarasKini').addEventListener('click', () => { tutup($('dlgMenu')); selarasKetuk(); });
  $('btnSelaras').addEventListener('click', selarasKetuk);

  $('btnPutus').addEventListener('click', async () => {
    const ok = await sahkan({ tajuk: 'Putuskan Google Drive?', teks: 'Data dalam peranti ini kekal. Data dalam Drive pun kekal, cuma tidak diselaras lagi dari peranti ini.', ya: 'Putuskan' });
    if (!ok) return;
    // Hanya lupakan token dalam peranti ini. Tak "revoke", sebab Client ID dikongsi dengan apps lain.
    selaras = { aktif: false, fid: null, asas: null, emel: null, masa: null, tok: null, exp: 0 };
    simpanSelaras();
    setStatus('mati');
    paparTetapanSelaras();
    toast('Google Drive diputuskan.');
  });

  /* ---------- Butang pasang ---------- */

  let pasangTunda = null;
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    pasangTunda = e;
    $('btnPasang').hidden = false;
  });
  $('btnPasang').addEventListener('click', async () => {
    const e = pasangTunda;
    if (!e) return;
    pasangTunda = null;
    $('btnPasang').hidden = true;
    try { e.prompt(); await e.userChoice; } catch (err) { /* pengguna batal */ }
  });
  window.addEventListener('appinstalled', () => {
    pasangTunda = null;
    $('btnPasang').hidden = true;
    toast('Diecast dipasang.');
  });

  /* ---------- Terjemahan English ---------- */

  // Apps ditulis dalam Bahasa Melayu. Bila English dipilih, teks pada skrin ditukar
  // ikut kamus dalam en.js setiap kali sesuatu dilukis. Input dan catatan tidak disentuh.
  function pasangTerjemahan() {
    const kamus = window.DIECAST_EN;
    if (BAHASA !== 'en' || !kamus) return;
    document.documentElement.lang = 'en';
    const tepat = kamus.tepat || {};
    const frasa = (kamus.frasa || []).map(([a, b]) => [new RegExp(a, 'g'), b]);
    const ada = Object.prototype.hasOwnProperty;
    function tukar(teks) {
      const m = /^(\s*)([\s\S]*?)(\s*)$/.exec(teks);
      const teras = m[2];
      if (!teras || !/[A-Za-z]/.test(teras)) return teks;
      if (ada.call(tepat, teras)) return m[1] + tepat[teras] + m[3];
      let t = teras;
      frasa.forEach(([re, ganti]) => { t = t.replace(re, ganti); });
      if (ada.call(tepat, t.trim())) t = tepat[t.trim()];
      return m[1] + t + m[3];
    }
    const LANGKAU = { TEXTAREA: 1, SCRIPT: 1, STYLE: 1 };
    const ATRIBUT = ['placeholder', 'title', 'aria-label'];
    function terjemahPokok(akar) {
      if (akar.nodeType === 3) {
        if (akar.parentNode && !LANGKAU[akar.parentNode.nodeName]) {
          const baru = tukar(akar.nodeValue);
          if (baru !== akar.nodeValue) akar.nodeValue = baru;
        }
        return;
      }
      if (akar.nodeType !== 1 || LANGKAU[akar.nodeName]) return;
      const els = [akar, ...akar.querySelectorAll('[placeholder], [title], [aria-label]')];
      els.forEach((el) => ATRIBUT.forEach((a) => {
        if (!el.hasAttribute || !el.hasAttribute(a)) return;
        const v = el.getAttribute(a);
        const baru = tukar(v);
        if (baru !== v) el.setAttribute(a, baru);
      }));
      const jalan = document.createTreeWalker(akar, NodeFilter.SHOW_TEXT);
      let n;
      while ((n = jalan.nextNode())) {
        if (LANGKAU[n.parentNode.nodeName]) continue;
        const baru = tukar(n.nodeValue);
        if (baru !== n.nodeValue) n.nodeValue = baru;
      }
    }
    terjemahPokok(document.body);
    document.title = 'Diecast';
    const pemerhati = new MutationObserver((senarai) => {
      pemerhati.disconnect();
      senarai.forEach((m) => {
        if (m.type === 'characterData') terjemahPokok(m.target);
        else if (m.type === 'attributes') terjemahPokok(m.target.nodeType === 1 ? m.target : m.target.parentNode);
        else m.addedNodes.forEach(terjemahPokok);
      });
      pemerhati.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATRIBUT });
    });
    pemerhati.observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATRIBUT });
  }

  $('segBahasa').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-bahasa]');
    if (!b || b.dataset.bahasa === BAHASA) return;
    tetapan.bahasa = b.dataset.bahasa;
    simpanTetapan();
    location.reload();
  });
  document.querySelectorAll('#segBahasa button').forEach((b) => b.classList.toggle('aktif', b.dataset.bahasa === BAHASA));

  /* ---------- Mula ---------- */

  muatTetapan();
  muatSelaras();
  gunaTema();
  pasangTerjemahan();
  muat();
  papar();
  siapGambar = muatGambar().then(async () => {
    await pindahGambar();
    papar();
    setTimeout(kemasGambar, 5000);
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    papar();
    if (selaras.aktif) selaraskan();
  });
  if (selaras.aktif) {
    setStatus(tokenSah() ? 'ok' : 'perlu');
    muatGis().catch(() => {});
    selaraskan();
  }
  window.addEventListener('online', () => { if (selaras.aktif) selaraskan(); });

  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    window.addEventListener('load', () => { navigator.serviceWorker.register('sw.js').catch(() => {}); });
  }
})();
