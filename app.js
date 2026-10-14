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
    beli: 'Belum Ship', otw: 'OTW', sampai: 'Sampai', hantar: 'Hantar', luar: 'Personal', arkib: 'Arkib',
  };
  const PERINGKAT = {
    beli: 'Belum ship', ship: 'Ke Oregon', hub: 'Di Oregon', keHK: 'Ke Hong Kong', hk: 'Di Hong Kong', kotak: 'Consolidate', post: 'Dipost ke MY',
    sampai: 'Sampai MY', hantar: 'Dihantar', selesai: 'Selesai',
  };
  const TAB_PERINGKAT = { beli: 'beli', ship: 'otw', hub: 'otw', keHK: 'otw', hk: 'otw', kotak: 'otw', post: 'otw', sampai: 'sampai', hantar: 'hantar', selesai: 'arkib' };
  const STATUS = { lunas: 'Dah bayar', depo: 'Depo', belum: 'Belum bayar', tiada: 'Tiada harga' };
  const BULAN = ['Jan', 'Feb', 'Mac', 'Apr', 'Mei', 'Jun', 'Jul', 'Ogo', 'Sep', 'Okt', 'Nov', 'Dis'];
  const AKU = 'AKU';

  let data = { v: 2, diubah: 0, items: [], orders: [], kotak: [], hantar: [], bank: '', kadar: null };
  let tetapan = { tema: 'sistem', tab: 'beli', status: 'semua', akaun: 'fa.rawyadal' };
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
      lama: !!x.lama,                             // dari Excel: OTW tanpa butiran perjalanan
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

  function bersihData(j) {
    naikTaraf(j);
    const d = {
      v: 2,
      diubah: Number(j.diubah) || Date.now(),
      items: (Array.isArray(j.items) ? j.items : []).map(bersihItem).filter(Boolean),
      orders: (Array.isArray(j.orders) ? j.orders : []).map(bersihOrder).filter(Boolean),
      kotak: (Array.isArray(j.kotak) ? j.kotak : []).map(bersihKotak).filter(Boolean),
      hantar: (Array.isArray(j.hantar) ? j.hantar : []).map(bersihHantar).filter(Boolean),
      bank: String(j.bank || '').slice(0, 300),
      kadar: nomborAtauNull(j.kadar) === null ? null : Math.round(Number(j.kadar) * 10000) / 10000,
      markup: nomborAtauNull(j.markup) || 0,      // caj tukaran kad (%) atas kadar pasaran
    };
    return d;
  }

  const eksportData = () => ({
    app: 'diecast', v: 2, diubah: data.diubah, items: data.items, orders: data.orders, kotak: data.kotak,
    hantar: data.hantar, bank: data.bank, kadar: data.kadar, markup: data.markup || 0,
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
    try { localStorage.setItem(KUNCI, JSON.stringify(eksportData())); } catch (e) { toast('Tak dapat simpan dalam peranti ini.'); }
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
  function labelKotak(k) { return k.tSampai ? 'Sampai MY' : k.tPost ? 'Dipost ke MY' : 'Tunggu tracking Skynet'; }
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
      '<div class="kotak"><span class="label">' + (luar ? 'Aku dah bayar' : 'Dah terima') + '</span><span class="nilai">' + rm(bayar) + '</span></div>' +
      '<div class="kotak baki' + (bk <= 0 ? ' sifar' : '') + '"><span class="label">' + (luar ? 'Baki aku' : 'Baki kastemer') + '</span><span class="nilai">' + rm(bk) + '</span></div>';
  }

  function barisPeringkat(it) {
    const p = peringkat(it);
    if (p === 'luar' || p === 'selesai') return '';
    const o = it.orderId ? cariOrder(it.orderId) : null;
    let teks = PERINGKAT[p];
    const k = it.kotakId ? cariKotak(it.kotakId) : null;
    if (p === 'beli' && o) teks += ' · ' + bilHari(o.tBeli) + ' hari';
    if (['ship', 'hub', 'keHK', 'hk'].includes(p) && it.tShip) teks += ' · ' + bilHari(it.tShip) + ' hari';
    if (p === 'post' && k) teks += ' · ' + bilHari(k.tPost) + ' hari';
    if (o && o.no) teks += ' · ' + o.no;
    return '<div class="kad-tahap"><span class="tahap-titik t-' + p + '"></span>' + esc(teks) + '</div>';
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
    const pil = aku ? '<span class="pil st-aku">Aku</span>' : '<span class="pil st-' + st + '">' + STATUS[st] + '</span>';
    let bawah = opt.peringkat === false ? '' : barisPeringkat(it);
    if (it.arkib) bawah += '<div class="kad-catatan">Selesai ' + tarikh(it.arkib) + '</div>';
    else if (it.catatan) bawah += '<div class="kad-catatan">' + esc(it.catatan) + '</div>';
    const bolehLeret = !it.arkib;
    return '<div class="kad-bungkus"' + (bolehLeret ? ' data-leret="' + esc(it.id) + '"' : '') + '>' +
      (bolehLeret ? '<div class="leret-latar" aria-hidden="true"><span class="l-kanan">✓ Bayar penuh</span><span class="l-kiri">Selesai · arkib ✓</span></div>' : '') +
      '<button type="button" class="kad st-' + (aku ? 'aku' : st) + '" data-id="' + esc(it.id) + '">' +
      '<div class="kad-atas"><div class="kad-nama">' +
      (it.jenis ? '<span class="jenis">' + esc(it.jenis) + '</span>' : '') + esc(it.nama) +
      (it.qty > 1 ? ' <span class="qty">×' + it.qty + '</span>' : '') + '</div>' + pil + '</div>' +
      (opt.orang && !aku ? '<div class="kad-orang">' + esc(it.orang || '-') + '</div>' : '') +
      wangH + bawah + '</button></div>';
  }

  /* ---------- Leret kad ---------- */

  // Leret ke kanan: rekod bayaran penuh (ada pengesahan).
  // Leret ke kiri: barang dah diserah, masuk Arkib (ada Buat asal).
  let leret = null;
  let abaikanKlik = false;
  const JARAK_LERET = 90;

  $('senarai').addEventListener('pointerdown', (e) => {
    const b = e.target.closest('[data-leret]');
    if (!b || e.button > 0 || e.target.closest('[data-g]')) return;
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
    if (bk <= 0) { toast(it.harga > 0 ? labelItem(it) + ' dah bayar penuh.' : labelItem(it) + ' belum ada harga.'); return; }
    const siapa = it.kat === 'jual' ? it.orang : 'aku';
    const ok = await sahkan({
      tajuk: 'Bayar penuh?',
      teks: 'Rekod bayaran baki ' + rm(bk) + ' dari ' + siapa + ' untuk ' + labelItem(it) + '.',
      ya: 'Rekod ' + rm(bk),
    });
    if (!ok) return;
    ubah(() => { it.bayaran.push({ id: idBaru(), amaun: bk, t: Date.now(), nota: 'Bayar penuh' }); }, rm(bk) + ' direkod. ' + labelItem(it) + ' dah bayar penuh.');
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
      '</div>' + kad + '</section>';
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

  function papar() {
    paparTab();
    $('bannerLogin').hidden = selaras.aktif || !!tetapan.tutupBanner || !data.items.length;
    const tab = tetapan.tab;
    const ada = data.items.length > 0 || data.orders.length > 0;
    $('kosongMula').hidden = ada;
    $('tapisBar').hidden = !ada;
    $('ringkas').hidden = !ada;
    if (!ada) { $('tab').hidden = true; $('senarai').innerHTML = ''; return; }

    const semua = itemTab(tab).filter(padanCari);
    paparRingkas(semua);
    const nampak = semua.filter(padanStatus);
    const ditapis = !!cari || tetapan.status !== 'semua';
    let html = '';

    if (tab === 'beli') {
      html += '<div class="bar-aksi"><button type="button" class="btn kecil utama" data-g="orderCM">+ Order CM</button>' +
        '<button type="button" class="btn kecil" data-g="senaraiOrder">Senarai order</button></div>';
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
          tajuk: o ? labelOrder(o) : 'Tempahan · belum beli',
          sub: o ? 'Dibeli ' + tarikh(o.tBeli) + (o.akaun ? ' · ' + esc(o.akaun) : '') + ' · ' + bilHari(o.tBeli) + ' hari' : its.length + ' item belum ada order CM',
          buka: o ? 'order:' + o.id : '',
          items: its,
          kad: { orang: true, peringkat: false },
          aksi: [o ? { g: 'declare', nilai: k, label: 'Declare' } : { g: 'orderCM', nilai: '-', label: 'Order CM', kelas: 'utama' }],
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
          kad: { orang: true, peringkat: false },
          aksi: [k.tPost ? { g: 'sampaiMY', nilai: k.id, label: 'Sampai MY', kelas: 'utama' } : { g: 'skynet', nilai: k.id, label: 'Isi Skynet', kelas: 'utama' }],
        });
      });
      const senaraiId = (its) => its.map((it) => it.id).join(',');
      const kumpPeringkat = (p, tajuk, sub, aksi) => {
        const its = nampak.filter((it) => peringkat(it) === p);
        if (!its.length) return;
        html += htmlKumpulan({ titik: p, tajuk, sub: its.length + ' item' + (sub ? ' · ' + sub : ''), items: its, kad: { orang: true }, aksi: aksi(its) });
      };
      kumpPeringkat('hk', 'Di Hong Kong', 'sedia consolidate', () => [{ g: 'kotakBaru', nilai: 'hk', label: 'Consolidate', kelas: 'utama' }]);
      kumpPeringkat('keHK', 'Oregon → Hong Kong', '', (its) => [{ g: 'hk', nilai: senaraiId(its), label: 'Sampai HK', kelas: 'utama' }]);
      kumpPeringkat('hub', 'Di Oregon', '', (its) => [{ g: 'keHK', nilai: senaraiId(its), label: 'Ke HK' }, { g: 'hk', nilai: senaraiId(its), label: 'Sampai HK' }]);
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
          tajuk: trk === '\u0000lama' ? 'OTW · dari Excel' : trk ? 'Ke Oregon · ' + trk : 'Ke Oregon · tanpa tracking',
          sub: trk === '\u0000lama' ? 'Tiada butiran perjalanan · masukkan ke kotak bila tahu' :
            'Ship ' + tarikh(tMin) + ' · ' + bilHari(tMin) + ' hari' + (its.some((it) => !it.tDeclare) ? ' · <span class="tag-amaran">Belum declare</span>' : ''),
          items: its, kad: { orang: true, peringkat: false },
          aksi: [{ g: 'undur', nilai: its.map((it) => it.id).join(','), label: 'Belum ship?' }, { g: 'hub', nilai: its.map((it) => it.id).join(','), label: 'Sampai Oregon' }],
        });
      });
    } else if (tab === 'sampai') {
      ikutOrang(nampak).sort((a, b) => (a.kunci === AKU) - (b.kunci === AKU) || a.nama.localeCompare(b.nama)).forEach((g) => {
        const aku = g.kunci === AKU;
        const bk = bakiPositif(g.items);
        const aksi = [];
        if (!aku && bk > 0) aksi.push({ g: 'waBaki', nilai: g.kunci, label: IKON_WA + 'Baki' });
        aksi.push(aku ? { g: 'ambil', nilai: g.items.map((it) => it.id).join(','), label: 'Dah ambil', kelas: 'utama' }
          : { g: 'serah', nilai: g.kunci, label: 'Serah', kelas: 'utama' });
        html += htmlKumpulan({
          tajuk: aku ? 'Barang aku' : g.nama,
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
            sub: (h.cara === 'pos' ? 'J&T' + (h.track ? ' ' + esc(h.track) : '') : 'Hantar sendiri') + ' · ' + tarikh(h.t) +
              (bk > 0 ? ' · baki <b>' + rm(bk) + '</b>' : ''),
            buka: 'hantar:' + h.id,
            items: its, kad: { peringkat: false },
            aksi: [{ g: 'waHantar', nilai: h.id, label: IKON_WA + 'Mesej' }, { g: 'terima', nilai: h.id, label: 'Dah terima', kelas: 'utama' }],
          });
        });
    } else if (tab === 'luar') {
      ikutOrang(nampak.sort(urut)).forEach((g) => {
        const bk = bakiPositif(g.items);
        html += htmlKumpulan({ tajuk: g.nama, sub: g.items.length + ' item' + (bk > 0 ? ' · baki aku <b>' + rm(bk) + '</b>' : ''), items: g.items, kad: {} });
      });
    } else if (tab === 'arkib') {
      const kump = new Map();
      nampak.sort((a, b) => b.arkib - a.arkib).forEach((it) => {
        const d = new Date(it.arkib);
        const k = BULAN[d.getMonth()] + ' ' + d.getFullYear();
        if (!kump.has(k)) kump.set(k, []);
        kump.get(k).push(it);
      });
      kump.forEach((its, k) => { html += htmlKumpulan({ tajuk: k, sub: its.length + ' item', items: its, kad: { orang: true, peringkat: false } }); });
    }

    if (!nampak.length) {
      const kosong = ditapis ? 'Tiada item yang padan.' : {
        beli: 'Tiada tempahan. Tekan Tempahan baru bila kastemer order.',
        otw: 'Tiada barang dalam perjalanan.',
        sampai: 'Tiada barang yang sedang menunggu untuk diserah.',
        hantar: 'Tiada barang yang sedang dihantar.',
        luar: 'Tiada barang personal. Ini untuk barang yang kau beli dari orang lain.',
        arkib: 'Belum ada item selesai.',
      }[tab];
      if (tab !== 'beli') html = '';
      html += '<p class="kosong">' + esc(kosong) + '</p>';
    }
    $('senarai').innerHTML = html;
  }

  $('senarai').addEventListener('click', (e) => {
    if (abaikanKlik) { abaikanKlik = false; return; }
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
    else if (g === 'hub') borangTanda(v.split(','), 'tHub', 'Sampai Oregon', 'sampai hub Oregon.');
    else if (g === 'keHK') borangTanda(v.split(','), 'tKeHK', 'Dihantar ke Hong Kong', 'dihantar ke Hong Kong.');
    else if (g === 'hk') borangTanda(v.split(','), 'tHK', 'Sampai Hong Kong', 'sampai Hong Kong. Boleh consolidate.');
    else if (g === 'undur') borangUndur(v.split(','));
    else if (g === 'orderCM') borangOrderBaru([]);
    else if (g === 'senaraiOrder') bukaSenaraiOrder();
    else if (g === 'kotakBaru') borangKotak(null, data.items.filter((it) => peringkat(it) === 'hk').map((it) => it.id));
    else if (g === 'skynet') borangSkynet(cariKotak(v));
    else if (g === 'sampaiMY') borangSampai(cariKotak(v));
    else if (g === 'waBaki') { const its = itemTab('sampai').filter((it) => kunciOrang(it.orang) === v); waBaki(its); }
    else if (g === 'serah') borangSerah(v);
    else if (g === 'ambil') ubah(() => { v.split(',').forEach((id) => { const it = cariItem(id); if (it) it.arkib = Date.now(); }); }, 'Barang aku diarkibkan.');
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
    '<button type="button" data-status="depo"><i class="titik s-depo"></i>Depo</button><button type="button" data-status="lunas"><i class="titik s-lunas"></i>Dah bayar</button>';
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
        sub: (it.kat === 'aku' ? 'Aku' : it.orang) + (o && o.no ? ' · ' + o.no : '') + (it.trackUS ? ' · ' + it.trackUS : ''),
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
        '<label class="medan">Kastemer <small>(AKU = sendiri)</small><input name="orang" list="senaraiOrang" maxlength="60" value="' + esc(b.orang || '') + '"></label></div>' +
        '<div class="dua"><label class="medan">Harga jual (RM)<input name="harga" type="number" inputmode="decimal" min="0" step="0.01" value="' + esc(b.harga == null ? '' : b.harga) + '"></label>' +
        '<label class="medan">Dah bayar (RM) <small>(pilihan)</small><input name="bayar" type="number" inputmode="decimal" min="0" step="0.01" value=""></label></div>' +
        '<div class="baris-btn"><button type="button" class="btn kecil" data-baris="salin">Salin baris</button>' +
        '<button type="button" class="btn kecil bahaya" data-baris="buang">Buang</button></div></div>';
    }
    return '<div class="baris-order">' +
      '<div class="dua"><label class="medan kecil">Jenis<input name="jenis" list="senaraiJenis" maxlength="20" placeholder="RLC" value="' + esc(b.jenis || '') + '"></label>' +
      '<label class="medan">Item<input name="nama" maxlength="80" placeholder="Contoh: Skyline R32" value="' + esc(b.nama || '') + '"></label></div>' +
      '<div class="dua"><label class="medan kecil">Qty<input name="qty" type="number" inputmode="numeric" min="1" step="1" value="' + esc(b.qty || 1) + '"></label>' +
      '<label class="medan"><span data-label-beli>Harga beli seunit (US$)</span><input name="beli" type="number" inputmode="decimal" min="0" step="0.01" value="' + esc(b.beli == null ? '' : b.beli) + '"></label></div>' +
      '<div class="dua"><label class="medan">Kastemer <small>(AKU = sendiri)</small><input name="orang" list="senaraiOrang" maxlength="60" value="' + esc(b.orang || '') + '"></label>' +
      '<label class="medan">Harga jual (RM)<input name="harga" type="number" inputmode="decimal" min="0" step="0.01" value="' + esc(b.harga == null ? '' : b.harga) + '"></label></div>' +
      '<div class="baris-btn"><button type="button" class="btn kecil" data-baris="salin">Salin baris</button>' +
      '<button type="button" class="btn kecil bahaya" data-baris="buang">Buang</button></div></div>';
  }

  function bacaBaris(el) {
    const q = (n) => { const x = el.querySelector('[name="' + n + '"]'); return x ? x.value : ''; };
    return { jenis: q('jenis'), nama: q('nama').trim(), qty: q('qty'), beli: q('beli'), orang: q('orang').trim(), harga: q('harga'), bayar: q('bayar') };
  }

  /* ---------- Tag item tempahan pada order ---------- */

  // Senarai item untuk ditag: setiap baris ada kotak tanda dan harga beli seunit (nampak bila ditanda).
  function htmlTag(calon, o) {
    if (!calon.length) return '<p class="nota kosong-kecil">Tiada item tempahan yang belum ada order. Tambah item lain di bawah, atau masukkan tempahan dulu.</p>';
    return (calon.length > 6 ? '<input class="tapis-pilih" type="search" data-tapis-pilih placeholder="Tapis: nama item atau kastemer">' : '') +
      '<div class="senarai-tag">' + calon.map((it) => {
        const pilih = o && it.orderId === o.id;
        return '<div class="tag-baris"><label><input type="checkbox" name="tag" value="' + esc(it.id) + '"' + (pilih ? ' checked' : '') + '>' +
          '<span><b>' + esc(labelItem(it)) + '</b><small>' + esc(it.kat === 'aku' ? 'Aku' : it.orang) + ' · ' + esc(PERINGKAT[peringkat(it)]) +
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
      if (!h) { tulis('Tak dapat ambil kadar (tiada internet?). Taip sendiri, atau isi jumlah dicaj kad.'); return; }
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
      return 'Kadar dikira ' + kadar + ' (RM' + caj + ' ÷ US$' + bulat(jumlahAsal) + '), tak munasabah. ' +
        'Pastikan harga beli semua item dan shipping dah diisi, atau kosongkan "jumlah dicaj kad" dan taip kadar terus (contoh 4.25).';
    }
    return 'Kadar ' + kadar + ' tak munasabah. Kadar ialah berapa RM untuk US$1 (contoh 4.25), bukan jumlah RM.';
  }

  function kiraKadar(f, jumlahAsal) {
    if (f.mata.value === 'RM') return 1;
    const caj = nomborAtauNull(f.caj.value);
    if (caj && jumlahAsal > 0) return Math.round((caj / jumlahAsal) * 10000) / 10000;
    return nomborAtauNull(f.kadar.value) ? Number(f.kadar.value) : null;
  }

  // Tempahan kastemer: masuk dulu sebelum beli dari CM.
  function borangTempahan() {
    isiDatalistOrang();
    borang({
      tajuk: 'Tempahan baru',
      nota: 'Barang yang kastemer tempah. Bila dah beli di CM, buat Order CM dan tag item ini.',
      html: '<div id="barisOrder" data-tanpa-beli>' + htmlBarisOrder(null, true) + '</div>' +
        '<button type="button" class="btn penuh-lebar" data-baris="tambah">+ Tambah item</button>',
      simpan: 'Simpan tempahan',
      hantar(f) {
        const baris = [...f.querySelectorAll('.baris-order')].map(bacaBaris).filter((x) => x.nama);
        if (!baris.length) return 'Isi sekurang-kurangnya satu item.';
        const tiada = baris.find((x) => !x.orang);
        if (tiada) return 'Isi kastemer untuk ' + tiada.nama + ' (taip AKU untuk barang sendiri).';
        ubah(() => {
          baris.forEach((x, i) => {
            const aku = kunciOrang(x.orang) === AKU;
            const bayar = bulat(x.bayar);
            data.items.push(bersihItem({
              kat: aku ? 'aku' : 'jual', jenis: x.jenis, nama: x.nama, qty: x.qty, orang: x.orang, tel: aku ? '' : telUntuk(x.orang),
              harga: aku ? 0 : x.harga, dibuat: Date.now(), urutan: Date.now() + i,
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
        '<h3>Item lain <small>(tiada tempahan, contoh untuk aku)</small></h3><div id="barisOrder"></div>' +
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
        if (tiada) return 'Isi kastemer untuk ' + tiada.nama + ' (taip AKU untuk barang sendiri).';
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
              harga: aku ? 0 : x.harga, beli: x.beli, orderId: o.id, dibuat: Date.now(), urutan: Date.now() + i,
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
    let html = '<h2>Senarai order</h2>';
    if (!ords.length) html += '<p class="kosong">Belum ada order. Tekan Order CM bila dah beli.</p>';
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
        return '<tr data-item="' + esc(it.id) + '"><td><b>' + esc(labelItem(it)) + '</b><small>' + esc(it.kat === 'aku' ? 'Aku' : it.orang) + ' · ' + esc(PERINGKAT[peringkat(it)]) + '</small></td>' +
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
      if (!h) { toast('Tak dapat ambil kadar. Semak internet.'); paparOrder(); return; }
      const k = denganMarkup(h.kadar);
      ubah(() => { o.kadar = k; o.kadarNota = notaPasaran(h); }, 'Kadar US$1 = RM' + k + ' (' + tarikh(dariInput(h.tarikh)) + ').');
    }
    else if (a === 'padam') {
      const ok = await sahkan({ tajuk: 'Padam order ' + (o.no || '') + '?', teks: 'Item dalam order ini tak dipadam. Ia cuma tak lagi ada harga beli dari order ini.', ya: 'Padam', bahaya: true });
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
        '<label class="tanda"><input type="checkbox" name="declare" checked> Dah declare di Buyandship</label>' +
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
        }, ids.length + ' item kini OTW ke hub.');
        return '';
      },
    });
  }

  // Pulangkan item ke Belum Ship (contoh: tersilap declare, atau data lama yang sebenarnya belum ship).
  function undurKeBeli(it) {
    it.tShip = null; it.trackUS = ''; it.tDeclare = null; it.tHub = null; it.tKeHK = null; it.tHK = null; it.kotakId = null; it.hantarId = null; it.lama = false;
  }

  function borangUndur(ids) {
    const calon = ids.map(cariItem).filter(Boolean);
    borang({
      tajuk: 'Pulangkan ke Belum Ship',
      nota: 'Tanda item yang sebenarnya belum ship. Tracking dan tarikh ship item itu akan dikosongkan.',
      html: senaraiPilih('item', pilihanItem(calon, [])),
      simpan: 'Pulangkan',
      hantar(f) {
        const pilih = nilaiPilih(f, 'item');
        if (!pilih.length) return 'Tanda sekurang-kurangnya satu item.';
        ubah(() => { pilih.forEach((id) => { const it = cariItem(id); if (it) undurKeBeli(it); }); }, pilih.length + ' item kembali ke Belum Ship.');
        return '';
      },
    });
  }

  function tandaHub(ids) {
    tandaMasa(ids, 'tHub', 'sampai hub Oregon.');
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
  function borangTanda(ids, kunci, tajuk, mesej) {
    const calon = ids.map(cariItem).filter(Boolean)
      .sort((a, b) => (a.trackUS || '').localeCompare(b.trackUS || '') || urut(a, b));
    borang({
      tajuk,
      nota: 'Tanda item yang berkenaan sahaja. Item dengan tracking yang sama ada di sebelah-menyebelah.',
      html: medanTarikh('t', 'Tarikh', Date.now(), true) + senaraiPilih('item', pilihanItem(calon, calon.length === 1 ? [calon[0].id] : [])),
      simpan: 'Simpan',
      hantar(f) {
        const pilih = nilaiPilih(f, 'item');
        if (!pilih.length) return 'Tanda sekurang-kurangnya satu item.';
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
      tajuk: 'Kotak sampai MY',
      nota: esc(namaKotak(k)) + ' · item akan pindah ke tab Sampai untuk sorting.',
      html: medanTarikh('t', 'Tarikh sampai', Date.now(), true),
      hantar(f) {
        ubah(() => { k.tSampai = dariInput(f.t.value); if (!k.tPost) k.tPost = k.tSampai; }, namaKotak(k) + ' sampai. ' + itemKotak(k).length + ' item dalam tab Sampai.');
        return '';
      },
    });
  }

  let kotakId = null;
  function bukaKotak(id) {
    kotakId = id;
    if (paparKotak()) buka($('dlgKotak'));
  }

  function garisMasa(baris) {
    return '<ol class="garis-masa">' + baris.map((b) =>
      '<li class="' + (b.t ? 'siap' : '') + '"><span class="bulatan"></span><span class="isi"><b>' + esc(b.label) + '</b>' +
      '<small>' + (b.t ? tarikh(b.t) : (b.kosong || 'Belum')) + (b.sub ? ' · ' + b.sub : '') + '</small></span>' +
      (b.salin ? '<button type="button" class="buang" data-salin="' + esc(b.salin) + '" aria-label="Salin ' + esc(b.salin) + '">' + IKON_SALIN + '</button>' : '') +
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
        : !k.tSampai ? '<button class="btn hijau penuh" type="button" data-aksi="sampai">Dah sampai MY</button>' : '') + '</div>';
    html += garisMasa([
      { label: 'Consolidate', t: k.tBuat, sub: k.kos !== null ? 'kos ' + rm(k.kos) : '' },
      { label: 'Dipost ke MY', t: k.tPost, sub: k.trackMY ? 'Skynet ' + esc(k.trackMY) : '', salin: k.trackMY },
      { label: 'Sampai MY', t: k.tSampai, sub: k.tSampai && k.tPost ? bilHari(k.tPost, k.tSampai) + ' hari perjalanan' : '' },
    ]);
    html += '<h3>Item (' + its.length + ')</h3><table class="jadual"><thead><tr><th>Item</th><th>Posting</th></tr></thead><tbody>' +
      its.map((it) => '<tr data-item="' + esc(it.id) + '"><td><b>' + esc(labelItem(it)) + '</b><small>' + esc(it.kat === 'aku' ? 'Aku' : it.orang) + '</small></td><td>' +
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
      const ok = await sahkan({ tajuk: 'Padam ' + namaKotak(k) + '?', teks: 'Item tak dipadam; ia kembali ke "Di Hong Kong".', ya: 'Padam', bahaya: true });
      if (!ok) return;
      ubah(() => { data.kotak = data.kotak.filter((x) => x !== k); }, 'Kotak dipadam.');
      tutup($('dlgKotak'));
    }
  });

  /* ---------- Serah pada kastemer ---------- */

  function borangSerah(kunci, tanda) {
    const calon = itemTab('sampai').filter((it) => kunciOrang(it.orang) === kunci);
    if (!calon.length) { toast('Tiada item yang dah sampai untuk kastemer ini.'); return; }
    const nama = calon[0].orang;
    const pilih = tanda && tanda.length ? tanda : calon.map((it) => it.id);
    borang({
      tajuk: 'Serah pada ' + nama,
      html: '<fieldset class="pilih-kat dua-pilih"><legend>Cara</legend>' +
        '<label><input type="radio" name="cara" value="pos" checked><span>Post J&amp;T</span></label>' +
        '<label><input type="radio" name="cara" value="sendiri"><span>Hantar sendiri</span></label></fieldset>' +
        '<div data-pos><div class="dua">' + medanTeks('track', 'Tracking J&amp;T', '', ' maxlength="60" data-fokus') +
        medanNombor('kos', 'Kos J&amp;T (RM) <small>(aku tanggung)</small>', '') + '</div></div>' +
        medanTarikh('t', 'Tarikh', Date.now(), true) +
        '<h3>Item</h3>' + senaraiPilih('item', pilihanItem(calon, pilih)),
      simpan: 'Simpan',
      lepas: (f) => {
        const segar = () => { f.querySelector('[data-pos]').hidden = f.cara.value !== 'pos'; };
        f.querySelectorAll('[name="cara"]').forEach((r) => r.addEventListener('change', segar));
        segar();
      },
      hantar(f) {
        const ids = nilaiPilih(f, 'item');
        if (!ids.length) return 'Tanda sekurang-kurangnya satu item.';
        const pos = f.cara.value === 'pos';
        const h = bersihHantar({
          id: idBaru(), orang: nama, cara: f.cara.value, track: pos ? f.track.value : '', kos: pos ? f.kos.value : null,
          t: dariInput(f.t.value), dibuat: Date.now(),
        });
        ubah(() => {
          data.hantar.push(h);
          ids.forEach((id) => { const it = cariItem(id); if (it) it.hantarId = h.id; });
        });
        toast(ids.length + ' item ' + (pos ? 'dipost' : 'dihantar') + ' pada ' + nama + '.', { label: 'WhatsApp', fn: () => waHantar(cariHantar(h.id)) });
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
        medanTarikh('t', 'Tarikh', h.t, true) +
        '<label class="tanda"><input type="checkbox" name="batal"> Batalkan hantaran ini (item kembali ke Sampai)</label>',
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
    }, h.orang + ' dah terima. Item masuk Arkib.');
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
    else baris.push(['Kos barang', k.barang]);
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
      beli: ['declare', 'Dah ship ke hub (declare)'],
      ship: ['hub', 'Dah sampai Oregon'],
      keHK: ['hk', 'Dah sampai Hong Kong'],
      hk: ['kotak', 'Consolidate (masuk kotak)'],
      hub: ['keHK', 'Dah dihantar ke Hong Kong'],
      kotak: ['bukaKotak', 'Buka kotak · isi Skynet'],
      post: ['bukaKotak', 'Buka kotak'],
      sampai: it.kat === 'aku' ? ['ambil', 'Dah ambil · selesai'] : ['serah', 'Serah pada kastemer'],
      hantar: ['terima', 'Kastemer dah terima'],
      luar: ['ambil', 'Dah terima barang · arkib'],
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

    let html = '<div class="butir-kepala"><h2>' + (it.jenis ? '<span class="jenis">' + esc(it.jenis) + '</span>' : '') +
      esc(it.nama) + (it.qty > 1 ? ' <span class="qty">×' + it.qty + '</span>' : '') + '</h2>' +
      (aku ? '<span class="pil st-aku">Aku</span>' : '<span class="pil st-' + st + '">' + STATUS[st] + '</span>') + '</div>';
    html += '<p class="butir-sub">' + (aku ? 'Barang aku sendiri' : esc(luar ? 'Beli dari ' : 'Kastemer: ') + '<b>' + esc(it.orang || '-') + '</b>') +
      (it.tel ? ' · <a href="tel:' + esc(it.tel.replace(/[^\d+]/g, '')) + '">' + esc(it.tel) + '</a>' : '') +
      (luar ? '' : '<br>' + esc(PERINGKAT[p] || '')) + '</p>';

    if (!aku || h > 0 || b > 0) {
      html += '<div class="wang3"><div><span>' + (it.kat === 'jual' ? 'Harga jual' : 'Harga') + '</span><b>' + rm(h) + '</b></div>' +
        '<div><span>' + (luar || aku ? 'Aku dah bayar' : 'Dah terima') + '</span><b>' + rm(b) + '</b></div>' +
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
        { label: 'Ship ke Oregon', t: it.tShip, sub: it.trackUS ? esc(it.trackUS) : '', salin: it.trackUS },
        { label: 'Sampai Oregon', t: it.tHub },
        { label: 'Oregon → Hong Kong', t: it.tKeHK },
        { label: 'Sampai Hong Kong', t: it.tHK },
        { label: 'Consolidate', t: k ? k.tBuat : null, sub: k ? esc(namaKotak(k)) : '' },
        { label: 'Dipost ke MY', t: k && k.tPost, sub: k && k.trackMY ? 'Skynet ' + esc(k.trackMY) : '', salin: k && k.trackMY },
        { label: 'Sampai MY', t: k && k.tSampai },
        aku ? null : { label: hh && hh.cara === 'sendiri' ? 'Hantar sendiri' : 'Post J&T', t: hh ? hh.t : null, sub: hh && hh.track ? esc(hh.track) : '', salin: hh && hh.track },
        { label: 'Selesai', t: it.arkib },
      ].filter(Boolean));
      html += '<div class="baris-btn pautan-kecil">' +
        (o ? '<button type="button" class="btn kecil" data-aksi="bukaOrder">Order ' + esc(o.no || '') + ' ›</button>' : '') +
        (k ? '<button type="button" class="btn kecil" data-aksi="bukaKotak">' + esc(namaKotak(k)) + ' ›</button>' : '') +
        '<button type="button" class="btn kecil" data-aksi="perjalanan">Betulkan tarikh</button></div>';
    }

    html += htmlKos(it);
    if (it.catatan) html += '<div class="catatan-penuh">' + esc(it.catatan) + '</div>';

    const undur = {
      ship: 'Batal declare · kembali ke Belum Ship', hub: 'Batal · kembali ke Belum Ship',
      keHK: 'Batal · kembali ke Belum Ship', hk: 'Batal · kembali ke Belum Ship',
      kotak: 'Keluarkan dari kotak', post: 'Keluarkan dari kotak', sampai: 'Keluarkan dari kotak', hantar: 'Batal serah · kembali ke Sampai',
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
    else if (a === 'undur') {
      const p = peringkat(it);
      ubah(() => {
        if (['ship', 'hub', 'keHK', 'hk'].includes(p)) undurKeBeli(it);
        else if (p === 'hantar') it.hantarId = null;
        else { it.kotakId = null; ['tHub', 'tKeHK', 'tHK'].forEach((x) => { if (!it[x]) it[x] = it.tShip || Date.now(); }); }
      }, labelItem(it) + ': ' + (['ship', 'hub', 'keHK', 'hk'].includes(p) ? 'kembali ke Belum Ship.' : p === 'hantar' ? 'kembali ke Sampai.' : 'dikeluarkan dari kotak (Di Hong Kong).'));
    }
    else if (a === 'bukaOrder') bukaOrder(it.orderId);
    else if (a === 'bukaKotak') bukaKotak(it.kotakId);
    else if (a === 'declare') borangDeclare([it.id]);
    else if (a === 'hub') tandaHub([it.id]);
    else if (a === 'keHK') tandaMasa([it.id], 'tKeHK', 'dihantar ke Hong Kong.');
    else if (a === 'hk') tandaMasa([it.id], 'tHK', 'sampai Hong Kong.');
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
      html: '<div class="dua">' + medanTarikh('tShip', 'Ship ke Oregon', it.tShip) + medanTeks('trackUS', 'Tracking US', it.trackUS, ' maxlength="60"') + '</div>' +
        '<div class="dua">' + medanTarikh('tDeclare', 'Declare BNS', it.tDeclare) + medanTarikh('tHub', 'Sampai Oregon', it.tHub) + '</div>' +
        '<div class="dua">' + medanTarikh('tKeHK', 'Oregon → HK', it.tKeHK) + medanTarikh('tHK', 'Sampai Hong Kong', it.tHK) + '</div>' + kotakPilih,
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
        '<label><input type="radio" name="kat" value="jual"' + (kat === 'jual' ? ' checked' : '') + '><span>Kastemer</span></label>' +
        '<label><input type="radio" name="kat" value="aku"' + (kat === 'aku' ? ' checked' : '') + '><span>Aku sendiri</span></label></fieldset>';
    }
    html += '<div class="dua"><label class="medan kecil">Jenis<input name="jenis" list="senaraiJenis" maxlength="20" value="' + esc(nilai.jenis) + '"></label>' +
      '<label class="medan">Item<input name="nama" maxlength="80" required value="' + esc(nilai.nama) + '"' + (it ? '' : ' data-fokus') + '></label></div>' +
      '<div class="dua"><label class="medan kecil">Qty<input name="qty" type="number" inputmode="numeric" min="1" step="1" value="' + esc(nilai.qty) + '"></label>' +
      '<label class="medan" data-orang>' + (luar ? 'Beli dari' : 'Kastemer') + '<input name="orang" list="senaraiOrang" maxlength="60" value="' + esc(kat === 'aku' ? '' : nilai.orang) + '"></label></div>' +
      '<div data-orang>' + medanTeks('tel', 'No. telefon <small>(pilihan)</small>', nilai.tel, ' type="tel" inputmode="tel" maxlength="30"') + '</div>' +
      '<div data-harga>' + medanNombor('harga', luar ? 'Harga (RM)' : 'Harga jual (RM)', nilai.harga || '') + '</div>';
    if (!it) html += medanNombor('bayarAwal', luar ? 'Aku dah bayar (RM)' : 'Dah bayar (RM)', '');
    if (!luar) {
      html += ordPilih +
        '<div class="dua"><label class="medan" data-beli>Harga beli seunit <small>(mata wang order)</small><input name="beli" type="number" inputmode="decimal" min="0" step="0.01" value="' + esc(nilai.beli === null ? '' : nilai.beli) + '"></label>' +
        '<label class="medan" data-modal>Kos RM <small>(tanpa order)</small><input name="modal" type="number" inputmode="decimal" min="0" step="0.01" value="' + esc(nilai.modal === null ? '' : nilai.modal) + '"></label></div>';
    }
    html += '<label class="medan">Catatan <small>(pilihan)</small><textarea name="catatan" rows="2" maxlength="300">' + esc(nilai.catatan) + '</textarea></label>';

    borang({
      tajuk: it ? 'Edit item' : luar ? 'Tambah barang personal' : 'Tambah item',
      nota: luar && !it ? 'Barang yang kau beli dari orang lain (contoh: Enal).' : '',
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
        if (k !== 'aku' && !f.orang.value.trim()) return luar ? 'Isi nama penjual.' : 'Isi nama kastemer.';
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
    $('bayarTajuk').textContent = it.kat === 'jual' ? 'Bayaran dari ' + (it.orang || 'kastemer') : 'Bayaran aku';
    $('bayarNota').textContent = labelItem(it) + ' · harga ' + rm(it.harga) + ', dah bayar ' + rm(dibayar(it)) + (bk > 0 ? ', baki ' + rm(bk) : '');
    f.amaun.value = bk > 0 ? bk : '';
    f.tarikh.value = tarikhInput();
    const cepat = [];
    if (bk > 0) cepat.push(['Baki ' + rm(bk), bk]);
    [100, 150, 200].forEach((n) => { if (bk <= 0 || n < bk) cepat.push(['Depo ' + rm(n), n]); });
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
      html += '<h2>Kastemer</h2><p class="nota">Barang yang belum selesai. Jumlah baki semua kastemer: <b>' + rm(jumlah) + '</b></p>';
      if (!semua.length) html += '<p class="kosong">Tiada barang kastemer yang aktif.</p>';
      html += semua.map((g) => '<button type="button" class="orang-baris" data-k="' + esc(g.kunci) + '"><span class="isi"><b>' + esc(g.nama) + '</b><small>' +
        g.items.length + ' item' + (g.tel ? ' · ' + esc(g.tel) : '') + '</small></span><span class="baki' + (g.baki <= 0 ? ' sifar' : '') + '">' +
        (g.baki > 0 ? rm(g.baki) : 'Lunas') + '</span></button>').join('');
    } else {
      const g = semua.find((x) => x.kunci === kunci);
      if (!g) { paparKastemer(null); return; }
      html += '<button type="button" class="balik" data-k="">‹ Semua kastemer</button>';
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
    if (b.dataset.wa) {
      const g = senaraiKastemer().find((x) => x.kunci === b.dataset.wa);
      if (g) waBaki(g.items);
      return;
    }
    if (b.dataset.k !== undefined) { paparKastemer(b.dataset.k || null); $('dlgKastemer').scrollTop = 0; }
  });

  /* ---------- WhatsApp ---------- */

  function bukaWa(tel, teks) {
    window.open('https://wa.me/' + noWa(tel) + '?text=' + encodeURIComponent(teks), '_blank', 'noopener');
  }

  function barisBaki(its) {
    return its.map((it) => {
      const b = dibayar(it);
      return '- ' + labelItem(it) + ': harga ' + rm(it.harga) + (b ? ', dah bayar ' + rm(b) : '') + (baki(it) > 0 ? ', baki ' + rm(baki(it)) : '');
    }).join('\n');
  }

  function waBaki(its) {
    const ada = its.filter((it) => baki(it) > 0);
    if (!ada.length) { toast('Tiada baki.'); return; }
    const jumlah = bakiPositif(ada);
    const sampai = ada.every((it) => peringkat(it) === 'sampai');
    let teks = 'Salam ' + ada[0].orang + '.\n\n' + (sampai ? 'Barang pre-order dah sampai. ' : '') + 'Berikut baki bayaran:\n' + barisBaki(ada) +
      (ada.length > 1 ? '\n\nJumlah baki: ' + rm(jumlah) : '') + '\n';
    if (data.bank) teks += '\n' + data.bank.trim() + '\n';
    teks += '\nTerima kasih.';
    bukaWa(ada.find((it) => it.tel) ? ada.find((it) => it.tel).tel : '', teks);
  }

  function waHantar(h) {
    if (!h) return;
    const its = itemHantar(h);
    const bk = bakiPositif(its);
    let teks = 'Salam ' + h.orang + '.\n\n';
    if (h.cara === 'pos') teks += 'Barang dah dipos guna J&T:\n' + its.map((it) => '- ' + labelItem(it)).join('\n') + (h.track ? '\n\nTracking J&T: ' + h.track : '') + '\n';
    else teks += 'Barang akan dihantar sendiri:\n' + its.map((it) => '- ' + labelItem(it)).join('\n') + '\n';
    if (bk > 0) {
      teks += '\nBaki bayaran: ' + rm(bk) + '\n';
      if (data.bank) teks += data.bank.trim() + '\n';
    }
    teks += '\nSila maklumkan bila barang dah sampai. Terima kasih.';
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
    const bulan = new Map();
    let tak = 0;
    jual.forEach((it) => {
      const o = it.orderId ? cariOrder(it.orderId) : null;
      const d = new Date(o ? o.tBeli : it.dibuat);
      const kunci = d.getFullYear() * 100 + d.getMonth();
      if (!bulan.has(kunci)) bulan.set(kunci, { label: BULAN[d.getMonth()] + ' ' + d.getFullYear(), n: 0, jual: 0, kos: 0, untung: 0, tak: 0, selesai: 0 });
      const g = bulan.get(kunci);
      const k = kosItem(it);
      g.n++;
      if (it.arkib) g.selesai++;
      if (k.lengkap) { g.jual += it.harga; g.kos += k.jumlah; g.untung += it.harga - k.jumlah; } else { g.tak++; tak++; }
    });
    const baris = [...bulan.entries()].sort((a, b) => b[0] - a[0]).map((x) => x[1]);
    const jum = baris.reduce((j, g) => ({ jual: j.jual + g.jual, kos: j.kos + g.kos, untung: j.untung + g.untung }), { jual: 0, kos: 0, untung: 0 });
    const kotakKos = data.kotak.reduce((j, k) => j + (k.kos || 0), 0);
    const jnt = data.hantar.reduce((j, h) => j + (h.kos || 0), 0);

    let html = '<h2>Untung rugi</h2><p class="nota">Ikut bulan order. Kira hanya item yang ada kos lengkap (harga beli dan kadar, atau kos RM).</p>';
    html += '<div class="wang3"><div><span>Jualan</span><b>' + rm(jum.jual) + '</b></div><div><span>Kos sebenar</span><b>' + rm(jum.kos) + '</b></div>' +
      '<div class="' + (jum.untung < 0 ? 'baki' : 'baki sifar') + '"><span>Untung</span><b>' + rm(jum.untung) + '</b></div></div>';
    html += '<table class="jadual"><thead><tr><th>Bulan</th><th>Jual</th><th>Kos</th><th>Untung</th></tr></thead><tbody>' +
      baris.map((g) => '<tr><td><b>' + g.label + '</b><small>' + g.n + ' item' + (g.tak ? ' · ' + g.tak + ' tanpa kos' : '') + '</small></td><td>' + rm(g.jual) + '</td><td>' + rm(g.kos) +
        '</td><td class="' + (g.untung < 0 ? 'rugi' : 'untung') + '">' + rm(g.untung) + '</td></tr>').join('') + '</tbody></table>';
    if (tak) html += '<p class="nota">' + tak + ' item belum ada kos, jadi tak dikira. Item dari Excel lama tiada harga beli; isi melalui Edit kalau perlu.</p>';
    html += '<p class="nota">Jumlah kos posting BNS direkod: ' + rm(kotakKos) + ' · kos J&amp;T: ' + rm(jnt) + '</p>';
    html += '<div class="aksi-bawah"><button class="btn" type="button" data-tutup="1">Tutup</button></div>';
    $('panelIsi').innerHTML = html;
  }
  $('panelIsi').addEventListener('click', (e) => {
    if (e.target.closest('[data-tutup]')) { tutup($('dlgPanel')); return; }
    const o = e.target.closest('[data-order]');
    if (o) bukaOrder(o.dataset.order);
  });
  $('btnUntung').addEventListener('click', () => { tutup($('dlgMenu')); setTimeout(bukaUntung, 0); });
  $('btnSenaraiOrder').addEventListener('click', () => { tutup($('dlgMenu')); setTimeout(bukaSenaraiOrder, 0); });

  /* ---------- Tetapan ---------- */

  $('btnMenu').addEventListener('click', () => {
    $('tetBank').value = data.bank || '';
    $('tetMarkup').value = data.markup || '';
    gunaTema();
    paparTetapanSelaras();
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

  $('btnEksport').addEventListener('click', () => {
    const isi = JSON.stringify(Object.assign({ disimpan: Date.now() }, eksportData()), null, 1);
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
      ['items', 'orders', 'kotak', 'hantar'].forEach((kunci) => {
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
    $('selarasTeks').textContent = s === 'perlu' || s === 'gagal' ? label : '';
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
  function mintaToken() {
    return muatGis().then(() => new Promise((ok, gagal) => {
      const id = (window.DIECAST_CONFIG || {}).CLIENT_ID;
      if (!id) { gagal(ralatSelaras('cfg')); return; }
      if (!klienToken) klienToken = google.accounts.oauth2.initTokenClient({ client_id: id, scope: SKOP, callback: () => {} });
      klienToken.callback = (r) => {
        if (!r || r.error) { gagal(ralatSelaras((r && r.error) || 'token')); return; }
        selaras.tok = r.access_token;
        selaras.exp = Date.now() + (Number(r.expires_in) || 3600) * 1000;
        simpanSelaras();
        ok();
      };
      klienToken.error_callback = (e) => gagal(ralatSelaras((e && e.type) || 'popup'));
      const o = { prompt: '' };
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
            teks: 'Data dalam Google Drive (diubah ' + masaPendek(r) + ') tak sama dengan data dalam peranti ini (diubah ' + masaPendek(l) + '). Guna yang mana?',
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
      toast(e.kod === 'popup_closed' || e.kod === 'access_denied' ? 'Sambungan dibatalkan.' : 'Tak dapat sambung ke Google. Cuba lagi.');
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
      ? 'Belum log masuk. Log masuk dengan akaun Google yang sama di phone dan PC untuk guna data yang sama. Data disimpan dalam folder tersembunyi khas apps ini dalam Google Drive kau; orang lain (dan apps lain) tak boleh baca.'
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
    const ok = await sahkan({ tajuk: 'Putuskan Google Drive?', teks: 'Data dalam peranti ini kekal. Data dalam Drive pun kekal, cuma tak diselaras lagi dari peranti ini.', ya: 'Putuskan' });
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

  /* ---------- Mula ---------- */

  muatTetapan();
  muatSelaras();
  gunaTema();
  muat();
  papar();

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
