/*
  Diecast: jejak barang pre-order diecast.
  Data disimpan dalam localStorage peranti ini, dan boleh diselaras dengan Google Drive.

  Kategori item:
    personal = barang aku order untuk diri sendiri
    otw      = barang kastemer yang dah ship, dalam perjalanan ke Malaysia
    tunggu   = barang kastemer yang dah beli tapi belum ship
  Item yang dah diserah (atau dah sampai untuk personal) diarkibkan, bukan dipadam.

  Status bayaran dikira daripada harga dan jumlah bayaran:
    dah bayar (hijau) | depo (kuning) | belum bayar (oren) | tiada harga (kelabu)
*/
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const KUNCI = 'diecast-data';
  const KUNCI_TETAPAN = 'diecast-tetapan';

  const KAT = {
    personal: { nama: 'Personal', orang: 'Penjual / kedai', bayar: 'Aku dah bayar' },
    otw: { nama: 'OTW', orang: 'Nama kastemer', bayar: 'Dah terima' },
    tunggu: { nama: 'Belum Ship', orang: 'Nama kastemer', bayar: 'Dah terima' },
  };
  const STATUS = {
    lunas: 'Dah bayar',
    depo: 'Depo',
    belum: 'Belum bayar',
    tiada: 'Tiada harga',
  };
  const BULAN = ['Jan', 'Feb', 'Mac', 'Apr', 'Mei', 'Jun', 'Jul', 'Ogo', 'Sep', 'Okt', 'Nov', 'Dis'];

  let data = { v: 1, diubah: 0, items: [], bank: '' };
  let tetapan = { tema: 'sistem', tab: 'otw', status: 'semua' };
  let cari = '';

  /* ---------- Alat kecil ---------- */

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const bulat = (n) => Math.round((Number(n) || 0) * 100) / 100;
  const idBaru = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  function rm(n) {
    n = bulat(n);
    const neg = n < 0;
    const a = Math.abs(n);
    const s = Number.isInteger(a)
      ? a.toLocaleString('en-US')
      : a.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return (neg ? '-RM' : 'RM') + s;
  }

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
    const d = new Date(+m[1], +m[2] - 1, +m[3], 12);
    return d.getTime();
  }

  const dibayar = (it) => bulat((it.bayaran || []).reduce((j, b) => j + (Number(b.amaun) || 0), 0));
  const baki = (it) => bulat((Number(it.harga) || 0) - dibayar(it));

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

  /* ---------- Simpan dan muat ---------- */

  function bersihItem(x) {
    if (!x || typeof x !== 'object' || !x.nama) return null;
    const kat = KAT[x.kat] ? x.kat : 'tunggu';
    return {
      id: String(x.id || idBaru()),
      kat,
      jenis: String(x.jenis || '').trim().toUpperCase().slice(0, 20),
      nama: String(x.nama).trim().slice(0, 80),
      qty: Math.max(1, parseInt(x.qty, 10) || 1),
      orang: String(x.orang || '').trim().slice(0, 60),
      tel: String(x.tel || '').trim().slice(0, 30),
      harga: bulat(x.harga),
      modal: x.modal === null || x.modal === '' || x.modal === undefined ? null : bulat(x.modal),
      bayaran: Array.isArray(x.bayaran)
        ? x.bayaran.filter((b) => b && Number(b.amaun)).map((b) => ({
          id: String(b.id || idBaru()),
          amaun: bulat(b.amaun),
          t: Number(b.t) || Date.now(),
          nota: String(b.nota || '').slice(0, 80),
        }))
        : [],
      catatan: String(x.catatan || '').slice(0, 300),
      arkib: Number(x.arkib) || null,
      dibuat: Number(x.dibuat) || Date.now(),
      urutan: Number(x.urutan) || 0,
    };
  }

  function bersihData(j) {
    return {
      v: 1,
      diubah: Number(j.diubah) || Date.now(),
      items: (Array.isArray(j.items) ? j.items : []).map(bersihItem).filter(Boolean),
      bank: String(j.bank || '').slice(0, 300),
    };
  }

  function muat() {
    try {
      const j = JSON.parse(localStorage.getItem(KUNCI) || 'null');
      if (j && Array.isArray(j.items)) data = bersihData(j);
    } catch (e) { /* data rosak: mula kosong */ }
  }

  function simpan(opt) {
    if (!(opt && opt.kekal)) data.diubah = Date.now();
    try { localStorage.setItem(KUNCI, JSON.stringify(data)); } catch (e) { toast('Tak dapat simpan dalam peranti ini.'); }
    if (!(opt && opt.kekal)) jadualSelaras();
  }

  function muatTetapan() {
    try {
      const j = JSON.parse(localStorage.getItem(KUNCI_TETAPAN) || '{}');
      if (j && typeof j === 'object') tetapan = Object.assign(tetapan, j);
    } catch (e) { /* guna lalai */ }
    if (!['personal', 'otw', 'tunggu', 'arkib'].includes(tetapan.tab)) tetapan.tab = 'otw';
    if (!['semua', 'belum', 'depo', 'lunas'].includes(tetapan.status)) tetapan.status = 'semua';
  }
  function simpanTetapan() {
    try { localStorage.setItem(KUNCI_TETAPAN, JSON.stringify(tetapan)); } catch (e) { /* tak penting */ }
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
    toastMasa = setTimeout(() => { t.hidden = true; }, btn ? 6000 : 3000);
  }

  /* ---------- Dialog dan butang Back telefon ---------- */

  // Setiap helaian yang dibuka ditambah ke sejarah browser, supaya butang Back
  // pada telefon menutup helaian itu dan bukan keluar dari apps.
  const tindan = [];
  let abaikanPop = 0;

  function buka(dlg) {
    if (dlg.open) return;
    dlg.showModal();
    tindan.push(dlg);
    history.pushState({ diecast: tindan.length }, '');
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
    // Ketuk luar helaian untuk tutup.
    dlg.addEventListener('click', (e) => { if (e.target === dlg) tutup(dlg); });
  });

  window.addEventListener('popstate', () => {
    if (abaikanPop > 0) { abaikanPop--; return; }
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

  /* ---------- Paparan senarai ---------- */

  function itemAktif(kat) { return data.items.filter((it) => !it.arkib && it.kat === kat); }

  function padanCari(it) {
    if (!cari) return true;
    const s = (it.nama + ' ' + it.jenis + ' ' + it.orang + ' ' + it.tel + ' ' + it.catatan).toLowerCase();
    return cari.toLowerCase().split(/\s+/).every((k) => s.includes(k));
  }

  function urut(a, b) { return (a.urutan - b.urutan) || (a.dibuat - b.dibuat); }

  function paparTab() {
    document.querySelectorAll('#tab button').forEach((b) => {
      b.setAttribute('aria-selected', String(b.dataset.kat === tetapan.tab));
    });
    ['personal', 'otw', 'tunggu'].forEach((k) => {
      document.querySelector('[data-kira="' + k + '"]').textContent = itemAktif(k).length;
    });
    document.querySelector('[data-kira="arkib"]').textContent = data.items.filter((it) => it.arkib).length;
    document.querySelectorAll('#cip button').forEach((b) => b.classList.toggle('aktif', b.dataset.status === tetapan.status));
  }

  function paparRingkas(senarai) {
    const tab = tetapan.tab;
    const jumlah = bulat(senarai.reduce((j, it) => j + (Number(it.harga) || 0), 0));
    const bayar = bulat(senarai.reduce((j, it) => j + dibayar(it), 0));
    const bk = bulat(senarai.reduce((j, it) => j + Math.max(0, baki(it)), 0));
    const lbBayar = tab === 'personal' ? 'Aku dah bayar' : tab === 'arkib' ? 'Dah terima' : 'Dah terima';
    const lbBaki = tab === 'personal' ? 'Baki aku' : 'Baki kastemer';
    $('ringkas').innerHTML =
      '<div class="kotak"><span class="label">Jumlah · ' + senarai.length + ' item</span><span class="nilai">' + rm(jumlah) + '</span></div>' +
      '<div class="kotak"><span class="label">' + lbBayar + '</span><span class="nilai">' + rm(bayar) + '</span></div>' +
      '<div class="kotak baki' + (bk <= 0 ? ' sifar' : '') + '"><span class="label">' + lbBaki + '</span><span class="nilai">' + rm(bk) + '</span></div>';
  }

  function htmlKad(it) {
    const st = status(it);
    const h = Number(it.harga) || 0;
    const b = dibayar(it);
    const bk = baki(it);
    let wang = '';
    if (h > 0 || b > 0) {
      wang = '<div class="kad-wang"><span>Harga <b>' + rm(h) + '</b></span>' +
        '<span>Bayar <b>' + rm(b) + '</b></span>' +
        (bk > 0 ? '<span class="baki">Baki <b>' + rm(bk) + '</b></span>' : '') +
        (bk < 0 ? '<span>Lebih <b>' + rm(-bk) + '</b></span>' : '') +
        '</div>';
    }
    let bawah = '';
    if (it.arkib) bawah = '<div class="kad-catatan">' + (it.kat === 'personal' ? 'Diterima ' : 'Diserah ') + tarikh(it.arkib) + ' · dari ' + esc(KAT[it.kat].nama) + '</div>';
    else if (it.catatan) bawah = '<div class="kad-catatan">' + esc(it.catatan) + '</div>';
    return '<button type="button" class="kad st-' + st + '" data-id="' + esc(it.id) + '">' +
      '<div class="kad-atas"><div class="kad-nama">' +
      (it.jenis ? '<span class="jenis">' + esc(it.jenis) + '</span>' : '') + esc(it.nama) +
      (it.qty > 1 ? ' <span class="qty">×' + it.qty + '</span>' : '') +
      '</div><span class="pil st-' + st + '">' + STATUS[st] + '</span></div>' +
      wang + bawah + '</button>';
  }

  function papar() {
    paparTab();
    const tab = tetapan.tab;
    const ada = data.items.length > 0;
    $('kosongMula').hidden = ada;
    $('tapisBar').hidden = !ada;
    $('ringkas').hidden = !ada;
    $('tab').hidden = !ada;
    if (!ada) { $('senarai').innerHTML = ''; return; }

    let semua = tab === 'arkib'
      ? data.items.filter((it) => it.arkib).sort((a, b) => b.arkib - a.arkib)
      : itemAktif(tab).sort(urut);
    semua = semua.filter(padanCari);
    paparRingkas(semua);

    const tapis = tetapan.status;
    const senarai = tapis === 'semua' ? semua : semua.filter((it) => status(it) === tapis || (tapis === 'lunas' && status(it) === 'lunas'));

    if (!senarai.length) {
      const kosongTeks = cari || tapis !== 'semua' ? 'Tiada item yang padan.'
        : tab === 'arkib' ? 'Belum ada item diarkibkan. Item yang dah diserah akan masuk ke sini.'
          : 'Tiada item dalam ' + KAT[tab].nama + '.';
      $('senarai').innerHTML = '<p class="kosong">' + esc(kosongTeks) + '</p>';
      return;
    }

    let html = '';
    if (tab === 'arkib') {
      let bulanLepas = '';
      senarai.forEach((it) => {
        const d = new Date(it.arkib);
        const bl = BULAN[d.getMonth()] + ' ' + d.getFullYear();
        if (bl !== bulanLepas) { html += '<h2 class="kumpulan-tajuk">' + bl + '</h2>'; bulanLepas = bl; }
        html += htmlKad(it);
      });
    } else {
      // Kumpul ikut nama (kastemer, atau penjual untuk personal), ikut susunan item pertama.
      const kump = new Map();
      senarai.forEach((it) => {
        const k = kunciOrang(it.orang) || '-';
        if (!kump.has(k)) kump.set(k, { nama: it.orang || 'Tanpa nama', items: [] });
        kump.get(k).items.push(it);
      });
      kump.forEach((g) => {
        const bk = bulat(g.items.reduce((j, it) => j + Math.max(0, baki(it)), 0));
        html += '<h2 class="kumpulan-tajuk">' + esc(g.nama) + (bk > 0 ? ' · baki ' + rm(bk) : '') + '</h2>';
        g.items.forEach((it) => { html += htmlKad(it); });
      });
    }
    $('senarai').innerHTML = html;
  }

  $('senarai').addEventListener('click', (e) => {
    const k = e.target.closest('.kad');
    if (k) bukaButir(k.dataset.id);
  });

  $('tab').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-kat]');
    if (!b) return;
    tetapan.tab = b.dataset.kat;
    simpanTetapan();
    papar();
    window.scrollTo({ top: 0 });
  });

  $('cip').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-status]');
    if (!b) return;
    tetapan.status = b.dataset.status;
    simpanTetapan();
    papar();
  });

  $('cari').addEventListener('input', (e) => { cari = e.target.value.trim(); papar(); });

  /* ---------- Butiran item ---------- */

  let butirId = null;
  const cariItem = (id) => data.items.find((it) => it.id === id);

  const IKON_WA = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm0 18.2c-1.5 0-3-.4-4.3-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.3-.4.2-.4.7-1.4.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5c-.2 0-.4.1-.7.3-.2.2-.9.9-.9 2.2s1 2.6 1.1 2.7c.1.2 1.9 2.9 4.6 4 1.7.7 2.4.8 3.2.7.5-.1 1.5-.6 1.8-1.2.2-.6.2-1.1.1-1.2l-.4-.3z"/></svg>';
  const IKON_BUANG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>';

  function bukaButir(id) {
    butirId = id;
    if (!paparButir()) return;
    buka($('dlgButir'));
  }

  function paparButir() {
    const it = cariItem(butirId);
    if (!it) { tutup($('dlgButir')); return false; }
    const st = status(it);
    const h = Number(it.harga) || 0;
    const b = dibayar(it);
    const bk = baki(it);
    const personal = it.kat === 'personal';
    const wa = noWa(it.tel);

    let html = '<div class="butir-kepala"><h2>' + (it.jenis ? '<span class="jenis">' + esc(it.jenis) + '</span>' : '') +
      esc(it.nama) + (it.qty > 1 ? ' <span class="qty">×' + it.qty + '</span>' : '') + '</h2>' +
      '<span class="pil st-' + st + '">' + STATUS[st] + '</span></div>';

    html += '<p class="butir-sub">' + esc(personal ? 'Dari ' : 'Kastemer: ') + '<b>' + esc(it.orang || '-') + '</b>' +
      (it.tel ? ' · <a href="tel:' + esc(it.tel.replace(/[^\d+]/g, '')) + '">' + esc(it.tel) + '</a>' : '') +
      '<br>' + esc(it.arkib ? (personal ? 'Diterima ' : 'Diserah ') + tarikh(it.arkib) + ' (Arkib, asal ' + KAT[it.kat].nama + ')' : KAT[it.kat].nama) + '</p>';

    html += '<div class="wang3"><div><span>Harga</span><b>' + rm(h) + '</b></div>' +
      '<div><span>' + (personal ? 'Aku dah bayar' : 'Dah terima') + '</span><b>' + rm(b) + '</b></div>' +
      '<div class="baki' + (bk <= 0 ? ' sifar' : '') + '"><span>' + (bk < 0 ? 'Terlebih' : 'Baki') + '</span><b>' + rm(Math.abs(bk)) + '</b></div></div>';

    if (it.modal !== null && !personal) {
      html += '<p class="untung">Modal ' + rm(it.modal) + ' · untung ' + rm(h - it.modal) + '</p>';
    }
    if (it.catatan) html += '<div class="catatan-penuh">' + esc(it.catatan) + '</div>';

    html += '<div class="grid-aksi">';
    html += '<button class="btn utama" type="button" data-aksi="bayar">+ Bayaran</button>';
    if (bk > 0) html += '<button class="btn hijau" type="button" data-aksi="penuh">Bayar penuh</button>';
    else html += '<button class="btn" type="button" data-aksi="edit">Edit</button>';
    if (!personal && bk > 0) {
      html += '<button class="btn penuh btn-wa" type="button" data-aksi="wa">' + IKON_WA + 'WhatsApp minta baki' + (wa ? '' : ' (pilih kontak)') + '</button>';
    }
    if (it.arkib) {
      html += '<button class="btn penuh" type="button" data-aksi="pulih">Pulihkan ke ' + esc(KAT[it.kat].nama) + '</button>';
    } else {
      if (it.kat === 'tunggu') html += '<button class="btn penuh" type="button" data-aksi="pindah" data-ke="otw">Dah ship · pindah ke OTW</button>';
      html += '<button class="btn penuh" type="button" data-aksi="arkib">' + (personal ? 'Dah terima barang · Arkibkan' : 'Dah serah pada kastemer · Arkibkan') + '</button>';
    }
    if (bk > 0) html += '<button class="btn" type="button" data-aksi="edit">Edit</button>';
    html += '<button class="btn bahaya' + (bk > 0 ? '' : ' penuh') + '" type="button" data-aksi="padam">Padam</button>';
    if (!it.arkib) {
      const lain = Object.keys(KAT).filter((k) => k !== it.kat && !(it.kat === 'tunggu' && k === 'otw'));
      html += '<p class="nota penuh" style="margin:6px 0 0">Pindah ke: ' + lain.map((k) =>
        '<button class="btn kecil" type="button" data-aksi="pindah" data-ke="' + k + '">' + KAT[k].nama + '</button>').join(' ') + '</p>';
    }
    html += '</div>';

    html += '<h3>Sejarah bayaran</h3>';
    const sej = (it.bayaran || []).slice().sort((x, y) => y.t - x.t);
    if (!sej.length) html += '<p class="nota">Belum ada bayaran.</p>';
    else {
      html += '<ul class="sejarah">' + sej.map((p) =>
        '<li><span class="tarikh">' + tarikh(p.t) + '</span><span class="isi">' + (p.nota ? esc(p.nota) : '<small>Bayaran</small>') +
        '</span><span class="amaun' + (p.amaun < 0 ? ' tolak' : '') + '">' + rm(p.amaun) + '</span>' +
        '<button class="buang" type="button" data-aksi="buangBayar" data-bid="' + esc(p.id) + '" aria-label="Buang bayaran ' + rm(p.amaun) + '">' + IKON_BUANG + '</button></li>').join('') + '</ul>';
    }
    html += '<p class="nota" style="margin-top:12px">Ditambah ' + tarikh(it.dibuat) + '</p>';
    html += '<div class="aksi-bawah"><button class="btn" type="button" data-aksi="tutup">Tutup</button></div>';
    $('butirIsi').innerHTML = html;
    return true;
  }

  $('butirIsi').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-aksi]');
    if (!b) return;
    const it = cariItem(butirId);
    if (!it) return;
    const aksi = b.dataset.aksi;

    if (aksi === 'tutup') tutup($('dlgButir'));
    else if (aksi === 'bayar') bukaBayar(it);
    else if (aksi === 'edit') bukaBorang(it);
    else if (aksi === 'penuh') {
      const bk = baki(it);
      const p = { id: idBaru(), amaun: bk, t: Date.now(), nota: 'Bayar penuh' };
      it.bayaran.push(p);
      simpan(); paparButir(); papar();
      toast('Bayaran ' + rm(bk) + ' direkod. ' + it.nama + ' dah bayar penuh.', {
        label: 'Buat asal',
        fn: () => { it.bayaran = it.bayaran.filter((x) => x.id !== p.id); simpan(); papar(); if ($('dlgButir').open) paparButir(); },
      });
    } else if (aksi === 'wa') {
      hantarWa(it.orang, it.tel, [it]);
    } else if (aksi === 'pindah') {
      const ke = b.dataset.ke;
      const dari = it.kat;
      it.kat = ke;
      simpan(); papar();
      tutup($('dlgButir'));
      toast(it.nama + ' dipindah ke ' + KAT[ke].nama + '.', { label: 'Buat asal', fn: () => { it.kat = dari; simpan(); papar(); } });
    } else if (aksi === 'arkib') {
      const bk = baki(it);
      if (bk > 0) {
        const ok = await sahkan({
          tajuk: 'Masih ada baki ' + rm(bk),
          teks: (it.kat === 'personal' ? 'Kau belum habis bayar item ini.' : it.orang + ' belum habis bayar.') + ' Arkibkan juga?',
          ya: 'Arkibkan',
        });
        if (!ok) return;
      }
      it.arkib = Date.now();
      simpan(); papar();
      tutup($('dlgButir'));
      toast(it.nama + ' diarkibkan.', { label: 'Buat asal', fn: () => { it.arkib = null; simpan(); papar(); } });
    } else if (aksi === 'pulih') {
      it.arkib = null;
      simpan(); papar();
      tutup($('dlgButir'));
      toast(it.nama + ' dipulihkan ke ' + KAT[it.kat].nama + '.');
    } else if (aksi === 'padam') {
      const ok = await sahkan({
        tajuk: 'Padam item ini?',
        teks: it.nama + (it.orang ? ' (' + it.orang + ')' : '') + ' dan sejarah bayarannya akan dipadam. Kalau barang dah diserah, guna Arkibkan.',
        ya: 'Padam', bahaya: true,
      });
      if (!ok) return;
      const i = data.items.indexOf(it);
      data.items.splice(i, 1);
      simpan(); papar();
      tutup($('dlgButir'));
      toast(it.nama + ' dipadam.', { label: 'Buat asal', fn: () => { data.items.splice(Math.min(i, data.items.length), 0, it); simpan(); papar(); } });
    } else if (aksi === 'buangBayar') {
      const p = it.bayaran.find((x) => x.id === b.dataset.bid);
      if (!p) return;
      const ok = await sahkan({ tajuk: 'Buang bayaran ini?', teks: rm(p.amaun) + ' pada ' + tarikh(p.t) + (p.nota ? ' (' + p.nota + ')' : ''), ya: 'Buang', bahaya: true });
      if (!ok) return;
      it.bayaran = it.bayaran.filter((x) => x !== p);
      simpan(); paparButir(); papar();
    }
  });

  /* ---------- Bayaran ---------- */

  let bayarId = null;
  function bukaBayar(it) {
    bayarId = it.id;
    const f = $('borangBayar');
    f.reset();
    const bk = baki(it);
    $('bayarTajuk').textContent = it.kat === 'personal' ? 'Bayaran aku' : 'Bayaran dari ' + (it.orang || 'kastemer');
    $('bayarNota').textContent = it.nama + ' · harga ' + rm(it.harga) + ', dah bayar ' + rm(dibayar(it)) + (bk > 0 ? ', baki ' + rm(bk) : '');
    f.amaun.value = bk > 0 ? bk : '';
    f.tarikh.value = tarikhInput();
    const cepat = [];
    if (bk > 0) cepat.push(['Baki ' + rm(bk), bk]);
    [50, 100, 200].forEach((n) => { if (bk <= 0 || n < bk) cepat.push([rm(n), n]); });
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
    it.bayaran.push({ id: idBaru(), amaun: n, t: dariInput(f.tarikh.value), nota: f.nota.value.trim().slice(0, 80) });
    simpan();
    tutup($('dlgBayar'));
    papar();
    if ($('dlgButir').open) paparButir();
    toast(rm(n) + ' direkod. Baki kini ' + rm(Math.max(0, baki(it))) + '.');
  });

  /* ---------- Tambah / edit item ---------- */

  let editId = null;

  function isiSenaraiOrang() {
    const nama = new Map();
    data.items.forEach((it) => { const k = kunciOrang(it.orang); if (k && !nama.has(k)) nama.set(k, it.orang); });
    $('senaraiOrang').innerHTML = [...nama.values()].map((n) => '<option value="' + esc(n) + '">').join('');
  }

  function labelBorang(kat) {
    $('labelOrang').textContent = KAT[kat].orang;
    $('medanModal').hidden = kat === 'personal';
    $('medanBayarAwal').firstChild.textContent = (kat === 'personal' ? 'Aku dah bayar' : 'Dah bayar') + ' (RM)';
  }

  function bukaBorang(it) {
    const f = $('borang');
    f.reset();
    editId = it ? it.id : null;
    isiSenaraiOrang();
    const kat = it ? it.kat : (tetapan.tab === 'arkib' ? 'tunggu' : tetapan.tab);
    f.kat.value = kat;
    labelBorang(kat);
    $('borangTajuk').textContent = it ? 'Edit item' : 'Tambah item';
    $('medanBayarAwal').hidden = !!it;
    $('borangRalat').textContent = '';
    if (it) {
      f.jenis.value = it.jenis;
      f.nama.value = it.nama;
      f.qty.value = it.qty;
      f.orang.value = it.orang;
      f.tel.value = it.tel;
      f.harga.value = it.harga || '';
      f.modal.value = it.modal === null ? '' : it.modal;
      f.catatan.value = it.catatan;
    }
    buka($('dlgBorang'));
    if (!it) setTimeout(() => f.nama.focus(), 50);
  }

  $('borang').addEventListener('change', (e) => {
    if (e.target.name === 'kat') labelBorang(e.target.value);
  });
  // Nama yang dah ada: isi nombor telefon sendiri.
  $('borang').orang.addEventListener('change', (e) => {
    const f = $('borang');
    if (f.tel.value) return;
    const k = kunciOrang(e.target.value);
    const ada = data.items.find((it) => kunciOrang(it.orang) === k && it.tel);
    if (ada) f.tel.value = ada.tel;
  });

  $('borangBatal').addEventListener('click', () => tutup($('dlgBorang')));

  $('borang').addEventListener('submit', (e) => {
    e.preventDefault();
    const f = e.target;
    const nama = f.nama.value.trim();
    const orang = f.orang.value.trim();
    if (!nama) { $('borangRalat').textContent = 'Isi nama item.'; return; }
    if (!orang) { $('borangRalat').textContent = 'Isi ' + KAT[f.kat.value].orang.toLowerCase() + '.'; return; }
    const nilai = {
      kat: f.kat.value,
      jenis: f.jenis.value,
      nama,
      qty: f.qty.value,
      orang,
      tel: f.tel.value,
      harga: f.harga.value,
      modal: f.kat.value === 'personal' || f.modal.value === '' ? null : f.modal.value,
      catatan: f.catatan.value.trim(),
    };
    if (editId) {
      const it = cariItem(editId);
      if (!it) { tutup($('dlgBorang')); return; }
      const bersih = bersihItem(Object.assign({}, it, nilai));
      Object.assign(it, bersih, { id: it.id, bayaran: it.bayaran, arkib: it.arkib, dibuat: it.dibuat, urutan: it.urutan });
      simpan();
      tutup($('dlgBorang'));
      papar();
      if ($('dlgButir').open) paparButir();
      toast('Disimpan.');
    } else {
      const awal = bulat(f.bayarAwal.value);
      const it = bersihItem(Object.assign(nilai, {
        id: idBaru(),
        dibuat: Date.now(),
        urutan: Date.now(),
        bayaran: awal ? [{ id: idBaru(), amaun: awal, t: Date.now(), nota: 'Bayaran awal' }] : [],
      }));
      data.items.push(it);
      simpan();
      tutup($('dlgBorang'));
      if (tetapan.tab !== it.kat) { tetapan.tab = it.kat; simpanTetapan(); }
      papar();
      toast(it.nama + ' ditambah ke ' + KAT[it.kat].nama + '.');
    }
  });

  $('btnTambah').addEventListener('click', () => bukaBorang(null));
  $('btnTambahMula').addEventListener('click', () => bukaBorang(null));

  /* ---------- Kastemer ---------- */

  function senaraiKastemer() {
    const peta = new Map();
    data.items.forEach((it) => {
      if (it.kat === 'personal' || it.arkib) return;
      const k = kunciOrang(it.orang) || '-';
      if (!peta.has(k)) peta.set(k, { kunci: k, nama: it.orang || 'Tanpa nama', tel: '', items: [] });
      const g = peta.get(k);
      g.items.push(it);
      if (!g.tel && it.tel) g.tel = it.tel;
    });
    return [...peta.values()].map((g) => Object.assign(g, {
      baki: bulat(g.items.reduce((j, it) => j + Math.max(0, baki(it)), 0)),
    })).sort((a, b) => (b.baki - a.baki) || a.nama.localeCompare(b.nama));
  }

  function paparKastemer(kunci) {
    const semua = senaraiKastemer();
    let html = '';
    if (!kunci) {
      const jumlah = bulat(semua.reduce((j, g) => j + g.baki, 0));
      html += '<h2>Kastemer</h2><p class="nota">Barang OTW dan Belum Ship yang belum diserah. Jumlah baki semua kastemer: <b>' + rm(jumlah) + '</b></p>';
      if (!semua.length) html += '<p class="kosong">Tiada barang kastemer yang aktif.</p>';
      html += semua.map((g) => '<button type="button" class="orang-baris" data-k="' + esc(g.kunci) + '"><span class="isi"><b>' + esc(g.nama) + '</b><small>' +
        g.items.length + ' item' + (g.tel ? ' · ' + esc(g.tel) : '') + '</small></span><span class="baki' + (g.baki <= 0 ? ' sifar' : '') + '">' +
        (g.baki > 0 ? rm(g.baki) : 'Selesai') + '</span></button>').join('');
    } else {
      const g = semua.find((x) => x.kunci === kunci);
      if (!g) { paparKastemer(null); return; }
      html += '<button type="button" class="balik" data-k="">‹ Semua kastemer</button>';
      html += '<h2>' + esc(g.nama) + '</h2>';
      html += '<p class="nota">' + (g.tel ? '<a href="tel:' + esc(g.tel.replace(/[^\d+]/g, '')) + '">' + esc(g.tel) + '</a> · ' : '') +
        g.items.length + ' item · baki <b>' + rm(g.baki) + '</b></p>';
      html += '<div>' + g.items.map((it) => {
        const st = status(it);
        return '<div class="item-mini"><i class="titik s-' + st + '"></i><span class="isi">' + (it.jenis ? esc(it.jenis) + ' ' : '') + esc(it.nama) +
          (it.qty > 1 ? ' ×' + it.qty : '') + '<small>' + KAT[it.kat].nama + ' · harga ' + rm(it.harga) + ', bayar ' + rm(dibayar(it)) + '</small></span>' +
          '<span class="baki">' + (baki(it) > 0 ? rm(baki(it)) : STATUS[st]) + '</span></div>';
      }).join('') + '</div>';
      html += '<div class="grid-aksi" style="margin-top:14px">';
      if (g.baki > 0) html += '<button class="btn utama penuh btn-wa" type="button" data-wa="' + esc(g.kunci) + '">' + IKON_WA + 'WhatsApp minta baki</button>';
      html += '<button class="btn penuh" type="button" data-tapis="' + esc(g.nama) + '">Tunjuk dalam senarai</button></div>';
    }
    html += '<div class="aksi-bawah"><button class="btn" type="button" data-tutup="1">Tutup</button></div>';
    $('kastemerIsi').innerHTML = html;
  }

  $('btnKastemer').addEventListener('click', () => { paparKastemer(null); buka($('dlgKastemer')); });
  $('kastemerIsi').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.tutup) { tutup($('dlgKastemer')); return; }
    if (b.dataset.wa) {
      const g = senaraiKastemer().find((x) => x.kunci === b.dataset.wa);
      if (g) hantarWa(g.nama, g.tel, g.items);
      return;
    }
    if (b.dataset.tapis !== undefined) {
      cari = b.dataset.tapis;
      $('cari').value = cari;
      tetapan.status = 'semua';
      // Pergi ke tab yang ada barang kastemer ini.
      const k = kunciOrang(cari);
      if (tetapan.tab === 'personal' || tetapan.tab === 'arkib' || !itemAktif(tetapan.tab).some((it) => kunciOrang(it.orang) === k)) {
        tetapan.tab = itemAktif('otw').some((it) => kunciOrang(it.orang) === k) ? 'otw' : 'tunggu';
      }
      simpanTetapan();
      tutup($('dlgKastemer'));
      papar();
      return;
    }
    if (b.dataset.k !== undefined) {
      paparKastemer(b.dataset.k || null);
      $('dlgKastemer').scrollTop = 0;
    }
  });

  /* ---------- WhatsApp ---------- */

  function hantarWa(nama, tel, items) {
    const ada = items.filter((it) => baki(it) > 0);
    const jumlah = bulat(ada.reduce((j, it) => j + baki(it), 0));
    const baris = ada.map((it) => {
      const b = dibayar(it);
      return '- ' + (it.jenis ? it.jenis + ' ' : '') + it.nama + (it.qty > 1 ? ' x' + it.qty : '') + ': harga ' + rm(it.harga) +
        (b ? ', dah bayar ' + rm(b) : '') + ', baki ' + rm(baki(it));
    });
    let teks = 'Salam ' + nama + '.\n\nBerikut baki bayaran pre-order:\n' + baris.join('\n') +
      (ada.length > 1 ? '\n\nJumlah baki: ' + rm(jumlah) : '') + '\n';
    if (data.bank) teks += '\n' + data.bank.trim() + '\n';
    teks += '\nTerima kasih.';
    const no = noWa(tel);
    window.open('https://wa.me/' + no + '?text=' + encodeURIComponent(teks), '_blank', 'noopener');
  }

  /* ---------- Tetapan ---------- */

  $('btnMenu').addEventListener('click', () => {
    $('tetBank').value = data.bank || '';
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
  $('tetBank').addEventListener('change', (e) => {
    data.bank = e.target.value.trim();
    simpan();
    toast('Maklumat bayaran disimpan.');
  });

  /* ---------- Simpan salinan dan import ---------- */

  $('btnEksport').addEventListener('click', () => {
    const isi = JSON.stringify({ app: 'diecast', v: 1, disimpan: Date.now(), diubah: data.diubah, items: data.items, bank: data.bank }, null, 1);
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
        teks: 'Ganti: data sekarang (' + data.items.length + ' item) dibuang dan diganti dengan fail ini.\nGabung: item dalam fail ditambah; item yang sama dikemas kini.',
        butang: [{ nilai: 'batal', label: 'Batal' }, { nilai: 'gabung', label: 'Gabung' }, { nilai: 'ganti', label: 'Ganti', kelas: 'utama' }],
      });
      if (!cara) return;
    }
    if (cara === 'ganti') {
      data.items = baru.items;
      if (baru.bank) data.bank = baru.bank;
    } else {
      baru.items.forEach((it) => {
        const i = data.items.findIndex((x) => x.id === it.id);
        if (i >= 0) data.items[i] = it; else data.items.push(it);
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

  const isiFail = () => JSON.stringify({ app: 'diecast', v: 1, diubah: data.diubah, items: data.items, bank: data.bank });

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
    papar();
    if ($('dlgButir').open) paparButir();
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
      ? 'Belum bersambung. Sambung untuk guna data yang sama di phone dan PC. Data disimpan dalam folder tersembunyi khas apps ini dalam Google Drive kau.'
      : 'Bersambung' + (selaras.emel ? ' sebagai ' + selaras.emel : '') + '. Apps selaras sendiri selepas setiap perubahan.';
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
    if (hasil === 'hantar' || hasil === 'sama') toast('Google Drive bersambung.');
  }
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
    if (document.visibilityState === 'visible' && selaras.aktif) selaraskan();
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
