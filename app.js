/* ═══════════════════════════════════════════
   토토사관학교 스캐너 뷰어 — app.js
═══════════════════════════════════════════ */

// ── 전역 상태 ──
let tree = {};           // { groupName: { txtName: { images, videos, scannedAt } } }
let currentGroupName = null;
let currentTxtName   = null;
let currentIdx       = null;
let currentTab       = 'all';
let modalFromFav     = false;
let favModalItems    = [];
let favFilters       = { img: true, vid: true };

const THUMB = [
    { label:'XS', min:80,  h:60  },
    { label:'S',  min:110, h:80  },
    { label:'M',  min:150, h:110 },
    { label:'L',  min:200, h:150 },
    { label:'XL', min:280, h:210 },
];
let tIdx = 2;

/* ═══════════════════════════════════════════
   즐겨찾기 스토리지
═══════════════════════════════════════════ */
const STORAGE_MEDIA = 'toto_fav_media_v1';

function loadFavMedia() {
    try { return new Set(JSON.parse(localStorage.getItem(STORAGE_MEDIA) || '[]')); }
    catch(e) { return new Set(); }
}
function saveFavMedia(s) {
    try { localStorage.setItem(STORAGE_MEDIA, JSON.stringify([...s])); } catch(e) {}
}

let favMedia = loadFavMedia();

function isMediaFav(url) { return favMedia.has(url); }

function isTxtFav(gn, tn) {
    if (!tree[gn]?.[tn]) return false;
    const items = getItems(gn, tn);
    return items.length > 0 && items.every(it => favMedia.has(it.url));
}

function toggleMediaFav(url) {
    if (favMedia.has(url)) favMedia.delete(url);
    else favMedia.add(url);
    saveFavMedia(favMedia);
    updateFavBadge();
}

function toggleTxtFav(gn, tn) {
    const items = getItems(gn, tn);
    const allFaved = items.length && items.every(it => favMedia.has(it.url));
    items.forEach(it => {
        if (allFaved) favMedia.delete(it.url);
        else favMedia.add(it.url);
    });
    saveFavMedia(favMedia);
    items.forEach(it => syncFavStars(it.url, !allFaved));
    updateFavBadge();
}

function updateFavBadge() {
    const n = favMedia.size;
    document.getElementById('fav-count-badge').textContent = n;
    if (currentTab === 'fav') renderFavTab();
}

/* ═══════════════════════════════════════════
   썸네일 크기
═══════════════════════════════════════════ */
function applyThumb() {
    const s = THUMB[tIdx];
    document.getElementById('thumb-label').textContent = s.label;
    document.querySelectorAll('.txt-content, .fav-grid').forEach(c => {
        c.style.gridTemplateColumns = `repeat(auto-fill, minmax(${s.min}px, 1fr))`;
    });
    document.querySelectorAll('.item-card img, .item-card video, .img-wrap').forEach(el => {
        el.style.height = s.h + 'px';
    });
}
function changeThumbSize(d) {
    tIdx = Math.max(0, Math.min(THUMB.length - 1, tIdx + d));
    applyThumb();
}

/* ═══════════════════════════════════════════
   탭 전환
═══════════════════════════════════════════ */
function switchTab(tab) {
    currentTab = tab;
    document.getElementById('tab-all').classList.toggle('active', tab === 'all');
    document.getElementById('tab-fav').classList.toggle('active', tab === 'fav');
    document.getElementById('main-container').style.display = tab === 'all' ? '' : 'none';
    document.getElementById('fav-container').style.display  = tab === 'fav' ? 'block' : 'none';
    const ff = document.getElementById('fav-filters');
    if (ff) ff.style.display = tab === 'fav' ? 'flex' : 'none';
    if (tab === 'fav') renderFavTab();
}

function toggleFilter(type) {
    favFilters[type] = !favFilters[type];
    document.getElementById('filter-' + type).classList.toggle('on', favFilters[type]);
    renderFavTab();
}

/* ═══════════════════════════════════════════
   TXT 파싱
═══════════════════════════════════════════ */
function parseTxt(text) {
    const images = [], videos = [];
    let scannedAt = '';
    const imgRe = /\.(jpg|jpeg|png|gif|webp|svg|bmp|ico|avif|tiff?)(\?.*)?$/i;
    const vidRe = /\.(mp4|webm|ogg|mov|avi|mkv|m4v|flv)(\?.*)?$/i;
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
    lines.forEach(l => { if (l.startsWith('수집일:')) scannedAt = l.replace('수집일:', '').trim(); });
    let section = null;
    lines.forEach(line => {
        if (line.startsWith('[이미지]'))                            { section = 'img'; return; }
        if (line.startsWith('[동영상') || line.startsWith('[MP4]')) { section = 'vid'; return; }
        if (/^[=\-]+$/.test(line) || line.startsWith('END') || line.startsWith('토토') || line.startsWith('MEDIA')) return;
        if (line.startsWith('페이지:') || line.startsWith('URL:') || line.startsWith('수집일:')) return;
        const raw = line.replace(/^\d+\s*\|\s*/, '');
        if (!raw.startsWith('http')) return;
        const url = raw.split(/\s/)[0];
        if      (section === 'img' || (!section && imgRe.test(url))) images.push(url);
        else if (section === 'vid' || (!section && vidRe.test(url))) videos.push(url);
    });
    return { images, videos, scannedAt };
}

function getGroupAndName(file) {
    let groupName = '(최상위)';
    let txtName   = file.name.replace(/\.txt$/i, '');
    if (file.webkitRelativePath) {
        const parts = file.webkitRelativePath.split('/');
        if (parts.length >= 3) groupName = parts[parts.length - 2];
    }
    return { groupName, txtName };
}

/* ═══════════════════════════════════════════
   파일 처리
═══════════════════════════════════════════ */
function processFiles(files) {
    const txtFiles = Array.from(files).filter(f => f.name.toLowerCase().endsWith('.txt'));
    if (!txtFiles.length) { alert('TXT 파일을 찾지 못했습니다.'); return; }
    tree = {};
    document.getElementById('main-container').innerHTML = '';
    let pending = txtFiles.length, totalImg = 0, totalVid = 0;
    txtFiles.forEach(file => {
        const { groupName, txtName } = getGroupAndName(file);
        const reader = new FileReader();
        reader.onload = e => {
            const data = parseTxt(e.target.result);
            if (!tree[groupName]) tree[groupName] = {};
            tree[groupName][txtName] = data;
            totalImg += data.images.length;
            totalVid += data.videos.length;
            if (--pending === 0) renderTree(totalImg, totalVid);
        };
        reader.readAsText(file, 'utf-8');
    });
}

function escT(s) { return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

/* ═══════════════════════════════════════════
   트리 렌더링
═══════════════════════════════════════════ */
function renderTree(totalImg, totalVid) {
    const mc = document.getElementById('main-container');
    mc.innerHTML = '';
    const groupNames = Object.keys(tree).sort();
    if (!groupNames.length) {
        mc.innerHTML = '<div class="empty-state"><div class="big-icon">◻</div><p>미디어를 찾지 못했습니다</p></div>';
        document.getElementById('stats-bar').style.display = 'none';
        document.getElementById('tab-bar').style.display   = 'none';
        return;
    }
    let totalTxts = 0;
    groupNames.forEach(g => { totalTxts += Object.keys(tree[g]).length; });
    document.getElementById('stat-groups').textContent = `${groupNames.length}개 폴더`;
    document.getElementById('stat-txts').textContent   = `TXT ${totalTxts}`;
    document.getElementById('stat-img').textContent    = `이미지 ${totalImg}`;
    document.getElementById('stat-vid').textContent    = `동영상 ${totalVid}`;
    document.getElementById('stats-bar').style.display = 'flex';
    document.getElementById('tab-bar').style.display   = 'flex';
    updateFavBadge();

    groupNames.forEach(groupName => {
        const txtMap   = tree[groupName];
        const txtNames = Object.keys(txtMap);
        const gImg = txtNames.reduce((s, t) => s + txtMap[t].images.length, 0);
        const gVid = txtNames.reduce((s, t) => s + txtMap[t].videos.length, 0);

        const gc = document.createElement('div');
        gc.className = 'group-container';
        gc.innerHTML = `
            <div class="group-header">
                <div class="group-left">
                    <div class="group-icon">
                        <svg width="15" height="15" viewBox="0 0 14 14" fill="none">
                            <path d="M1.5 4.5C1.5 3.95 1.95 3.5 2.5 3.5H5.5L6.5 4.5H11.5C12.05 4.5 12.5 4.95 12.5 5.5V10.5C12.5 11.05 12.05 11.5 11.5 11.5H2.5C1.95 11.5 1.5 11.05 1.5 10.5V4.5Z" stroke="#7ee8a2" stroke-width="1.1" fill="none"/>
                        </svg>
                    </div>
                    <span class="group-name">${escT(groupName)}</span>
                    <div class="group-meta">
                        <span class="group-count">${txtNames.length}개 파일</span>
                        ${gImg ? `<span class="tag tag-img">IMG ${gImg}</span>` : ''}
                        ${gVid ? `<span class="tag tag-video">VID ${gVid}</span>` : ''}
                    </div>
                </div>
                <span class="group-arrow">▼</span>
            </div>
            <div class="group-content"></div>`;
        gc.querySelector('.group-header').addEventListener('click', function () { toggleGroup(this, groupName); });
        mc.appendChild(gc);
    });
}

function toggleGroup(header, groupName) {
    const content  = header.nextElementSibling;
    const isLoaded = content.getAttribute('data-loaded') === 'true';
    if (!isLoaded) {
        Object.keys(tree[groupName]).sort().forEach(txtName => {
            content.appendChild(makeTxtContainer(groupName, txtName));
        });
        content.setAttribute('data-loaded', 'true');
        content.style.display = 'block';
        header.classList.add('active');
    } else {
        const open = content.style.display === 'none';
        content.style.display = open ? 'block' : 'none';
        open ? header.classList.add('active') : header.classList.remove('active');
    }
}

function makeTxtContainer(groupName, txtName) {
    const data    = tree[groupName][txtName];
    const tImg    = data.images.length;
    const tVid    = data.videos.length;
    const starred = isTxtFav(groupName, txtName);

    const tc = document.createElement('div');
    tc.className = 'txt-container';
    tc.innerHTML = `
        <div class="txt-header">
            <div class="txt-left">
                <div class="txt-icon">
                    <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
                        <rect x="1.5" y="1" width="9" height="10" rx="1.5" stroke="#3b82f6" stroke-width="1"/>
                        <path d="M3.5 4.5H8.5M3.5 6.5H7" stroke="#3b82f6" stroke-width="0.9" stroke-linecap="round"/>
                    </svg>
                </div>
                <span class="txt-name">${escT(txtName)}</span>
                <div class="txt-meta">
                    ${tImg ? `<span class="tag tag-img">IMG ${tImg}</span>` : ''}
                    ${tVid ? `<span class="tag tag-video">VID ${tVid}</span>` : ''}
                    ${data.scannedAt ? `<span class="tag-date">${data.scannedAt}</span>` : ''}
                </div>
            </div>
            <div style="display:flex;align-items:center;gap:6px;">
                <button class="txt-fav-btn ${starred ? 'starred' : ''}" title="파일 전체 즐겨찾기">★</button>
                <span class="txt-arrow">▼</span>
            </div>
        </div>
        <div class="txt-content"></div>`;

    const favBtn = tc.querySelector('.txt-fav-btn');
    favBtn.addEventListener('click', ev => {
        ev.stopPropagation();
        const items = getItems(groupName, txtName);
        toggleTxtFav(groupName, txtName);
        const isNow = isTxtFav(groupName, txtName);
        favBtn.classList.toggle('starred', isNow);
        showToast(isNow ? `전체 즐겨찾기 ★ (${items.length}개)` : `즐겨찾기 해제 (${items.length}개)`);
        if (currentTab === 'fav') renderFavTab();
    });

    tc.querySelector('.txt-header').addEventListener('click', function (ev) {
        if (ev.target.closest('.txt-fav-btn')) return;
        toggleTxt(this, groupName, txtName);
    });
    return tc;
}

function toggleTxt(header, groupName, txtName) {
    const content  = header.nextElementSibling;
    const isLoaded = content.getAttribute('data-loaded') === 'true';
    const s        = THUMB[tIdx];
    if (!isLoaded) {
        getItems(groupName, txtName).forEach((item, idx) => {
            content.appendChild(makeCard(item, idx, groupName, txtName, false));
        });
        content.setAttribute('data-loaded', 'true');
        content.style.gridTemplateColumns = `repeat(auto-fill, minmax(${s.min}px, 1fr))`;
        content.style.display = 'grid';
        header.classList.add('active');
    } else {
        const open = content.style.display === 'none';
        content.style.display = open ? 'grid' : 'none';
        open ? header.classList.add('active') : header.classList.remove('active');
    }
}

/* ═══════════════════════════════════════════
   카드 생성
═══════════════════════════════════════════ */
function makeCard(item, idx, groupName, txtName, inFavView) {
    const s    = THUMB[tIdx];
    const card = document.createElement('div');
    card.className = 'item-card';

    if (item.type === 'video') {
        const vid = document.createElement('video');
        vid.src = item.url + '#t=0.5';
        vid.preload = 'metadata';
        vid.style.height = s.h + 'px';
        const badge = document.createElement('span');
        badge.className = 'badge badge-video'; badge.textContent = 'VID';
        card.append(badge, vid);
    } else {
        const wrap = document.createElement('div');
        wrap.className = 'img-wrap';
        wrap.style.height = s.h + 'px';
        const img = document.createElement('img');
        img.src = item.url; img.loading = 'lazy';
        img.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block;';
        img.onerror = () => { wrap.innerHTML = ''; wrap.textContent = 'CORS'; wrap.title = item.url; };
        const badge = document.createElement('span');
        badge.className = 'badge badge-img'; badge.textContent = 'IMG';
        wrap.appendChild(img);
        card.append(badge, wrap);
    }

    const starBtn = document.createElement('button');
    starBtn.className = 'fav-star-btn' + (isMediaFav(item.url) ? ' starred' : '');
    starBtn.textContent = '★';
    starBtn.title = '즐겨찾기';
    starBtn.addEventListener('click', ev => {
        ev.stopPropagation();
        toggleMediaFav(item.url);
        const nowFav = isMediaFav(item.url);
        starBtn.classList.toggle('starred', nowFav);
        if (currentGroupName === groupName && currentTxtName === txtName && currentIdx === idx) updateModalFavBtn();
        syncFavStars(item.url, nowFav);
        showToast(nowFav ? '즐겨찾기 추가 ★' : '즐겨찾기 해제');
        if (inFavView && !nowFav) { card.style.opacity = '0.3'; setTimeout(() => renderFavTab(), 500); }
    });
    card.appendChild(starBtn);

    card.addEventListener('click', () => openModal(groupName, txtName, idx, inFavView));
    return card;
}

function syncFavStars(url, starred) {
    document.querySelectorAll('.fav-star-btn').forEach(btn => {
        const card  = btn.closest('.item-card');
        if (!card) return;
        const imgEl = card.querySelector('img');
        const vidEl = card.querySelector('video');
        const cu    = (imgEl && imgEl.src) || (vidEl && vidEl.src.replace(/#t=0\.5$/, ''));
        if (cu === url) btn.classList.toggle('starred', starred);
    });
}

/* ═══════════════════════════════════════════
   즐겨찾기 탭
═══════════════════════════════════════════ */
function renderFavTab() {
    const fc = document.getElementById('fav-container');
    fc.innerHTML = '';

    let mediaFavItems = [];
    Object.keys(tree).sort().forEach(gn => {
        Object.keys(tree[gn]).sort().forEach(tn => {
            getItems(gn, tn).forEach((item, idx) => {
                if (isMediaFav(item.url)) mediaFavItems.push({ ...item, groupName: gn, txtName: tn, idx });
            });
        });
    });

    const filtered = mediaFavItems.filter(it =>
        (it.type === 'image' && favFilters.img) || (it.type === 'video' && favFilters.vid)
    );

    if (!filtered.length) {
        fc.innerHTML = `<div class="fav-empty"><div class="big-icon">★</div><p>즐겨찾기가 없습니다</p><p class="sub">카드의 ★ 버튼으로 추가하세요</p></div>`;
        return;
    }

    const grouped = {};
    filtered.forEach(it => {
        const key = it.groupName + '|||' + it.txtName;
        if (!grouped[key]) grouped[key] = { groupName: it.groupName, txtName: it.txtName, items: [] };
        grouped[key].items.push(it);
    });

    const s = THUMB[tIdx];
    Object.values(grouped).forEach(g => {
        const sec = document.createElement('div');
        sec.className = 'fav-section';
        sec.innerHTML = `
            <div class="fav-section-title">
                <span class="fav-sec-tag">★</span>
                ${escT(g.groupName)} / ${escT(g.txtName)}
                <span style="color:#333;margin-left:auto;">${g.items.length}개</span>
            </div>
            <div class="fav-grid" style="grid-template-columns:repeat(auto-fill,minmax(${s.min}px,1fr))"></div>`;
        const grid = sec.querySelector('.fav-grid');
        g.items.forEach(it => grid.appendChild(makeCard(it, it.idx, it.groupName, it.txtName, true)));
        fc.appendChild(sec);
    });
}

/* ═══════════════════════════════════════════
   전체 미디어 플랫 리스트 (파일 경계 횡단용)
═══════════════════════════════════════════ */
function buildGlobalList(fromFav) {
    const list = [];
    Object.keys(tree).sort().forEach(gn => {
        Object.keys(tree[gn]).sort().forEach(tn => {
            getItems(gn, tn).forEach((item, idx) => {
                if (!fromFav || isMediaFav(item.url)) {
                    list.push({ ...item, groupName: gn, txtName: tn, idx });
                }
            });
        });
    });
    return list;
}

/* ═══════════════════════════════════════════
   모달
═══════════════════════════════════════════ */
function getItems(gn, tn) {
    const d = tree[gn][tn];
    return [
        ...d.images.map(url => ({ url, type: 'image' })),
        ...d.videos.map(url => ({ url, type: 'video' })),
    ];
}

function openModal(gn, tn, idx, inFavView) {
    currentGroupName = gn;
    currentTxtName   = tn;
    currentIdx       = idx;
    modalFromFav     = !!inFavView;
    if (inFavView) favModalItems = buildGlobalList(true);
    renderModal();
    document.getElementById('modal').style.display = 'flex';
}

function renderModal(slideDir) {
    const items = getItems(currentGroupName, currentTxtName);
    const item  = items[currentIdx];
    if (!item) return;

    const mb = document.getElementById('modal-body');

    // 기존 비디오 정지
    const prev = mb.querySelector('video');
    if (prev) { prev.pause(); prev.removeAttribute('src'); prev.load(); }
    mb.innerHTML = '';

    // 슬라이드 애니메이션
    if (slideDir) {
        mb.classList.remove('sliding-left', 'sliding-right');
        void mb.offsetWidth; // reflow
        mb.classList.add(slideDir === 1 ? 'sliding-left' : 'sliding-right');
    }

    if (item.type === 'video') {
        const vid = document.createElement('video');
        vid.src = item.url; vid.controls = true; vid.autoplay = true;
        mb.appendChild(vid);
    } else {
        const img = document.createElement('img');
        img.src = item.url; img.alt = '';
        mb.appendChild(img);
    }

    // 카운터: 파일명 + 현재/전체
    const allItems = modalFromFav ? favModalItems : buildGlobalList(false);
    const globalIdx = allItems.findIndex(it => it.groupName === currentGroupName && it.txtName === currentTxtName && it.idx === currentIdx);
    document.getElementById('modal-counter').textContent =
        `${currentTxtName}  ${currentIdx + 1}/${items.length}  [${globalIdx + 1}/${allItems.length}]`;

    updateModalFavBtn();
}

function updateModalFavBtn() {
    const items = getItems(currentGroupName, currentTxtName);
    const item  = items[currentIdx];
    if (!item) return;
    document.getElementById('modal-fav-btn').classList.toggle('starred', isMediaFav(item.url));
}

function toggleModalFav() {
    const item = getItems(currentGroupName, currentTxtName)[currentIdx];
    if (!item) return;
    toggleMediaFav(item.url);
    const nowFav = isMediaFav(item.url);
    updateModalFavBtn();
    syncFavStars(item.url, nowFav);
    showToast(nowFav ? '즐겨찾기 추가 ★' : '즐겨찾기 해제');
}

/* ── 이동: 파일 경계 횡단 ── */
function goNext(d, slideDir) {
    if (!currentGroupName) return;

    let list;
    if (modalFromFav) {
        list = favModalItems;
    } else {
        list = buildGlobalList(false);
    }

    const cur  = list.findIndex(it => it.groupName === currentGroupName && it.txtName === currentTxtName && it.idx === currentIdx);
    const next = (cur + d + list.length) % list.length;
    const it   = list[next];
    currentGroupName = it.groupName;
    currentTxtName   = it.txtName;
    currentIdx       = it.idx;

    renderModal(slideDir !== undefined ? slideDir : d);
    showToast(`${currentIdx + 1} / ${getItems(currentGroupName, currentTxtName).length}`);
}

function closeModal() {
    const mb = document.getElementById('modal-body');
    const v  = mb.querySelector('video');
    if (v) { v.pause(); v.removeAttribute('src'); v.load(); }
    mb.innerHTML = '';
    document.getElementById('modal').style.display = 'none';
    currentGroupName = null; currentTxtName = null; currentIdx = null;
    modalFromFav = false;
}

/* ═══════════════════════════════════════════
   모바일 터치 스와이프
═══════════════════════════════════════════ */
(function initSwipe() {
    let startX = 0, startY = 0;
    const SWIPE_THRESHOLD = 40;
    const DOWN_THRESHOLD  = 60;

    document.getElementById('modal').addEventListener('touchstart', e => {
        startX = e.touches[0].clientX;
        startY = e.touches[0].clientY;
    }, { passive: true });

    document.getElementById('modal').addEventListener('touchend', e => {
        if (document.getElementById('modal').style.display !== 'flex') return;
        const dx = e.changedTouches[0].clientX - startX;
        const dy = e.changedTouches[0].clientY - startY;

        // 아래로 스와이프 → 닫기
        if (dy > DOWN_THRESHOLD && Math.abs(dx) < Math.abs(dy)) {
            closeModal();
            return;
        }
        // 좌우 스와이프 → 이전/다음
        if (Math.abs(dx) > SWIPE_THRESHOLD && Math.abs(dx) > Math.abs(dy)) {
            if (dx < 0) goNext(+1, +1);   // 왼쪽 → 다음
            else        goNext(-1, -1);   // 오른쪽 → 이전
        }
    }, { passive: true });
})();

/* ═══════════════════════════════════════════
   키보드 (데스크탑)
═══════════════════════════════════════════ */
document.addEventListener('keydown', e => {
    if (e.key === 'Escape') { closeModal(); return; }
    if (document.getElementById('modal').style.display !== 'flex') return;

    if (e.key === 'e' || e.key === 'E' || e.key === 'ArrowRight') { e.preventDefault(); goNext(+1); return; }
    if (e.key === 'q' || e.key === 'Q' || e.key === 'ArrowLeft')  { e.preventDefault(); goNext(-1); return; }
    if (e.key === 'f' || e.key === 'F') { e.preventDefault(); toggleModalFav(); return; }

    const v = document.getElementById('modal-body').querySelector('video');
    if      (e.key === 'd' || e.key === 'D') { e.preventDefault(); if (v) { v.currentTime = Math.min(v.currentTime + 1, v.duration);  showToast('+1초'); } }
    else if (e.key === 'a' || e.key === 'A') { e.preventDefault(); if (v) { v.currentTime = Math.max(v.currentTime - 1, 0);            showToast('-1초'); } }
    else if (e.key === 'w' || e.key === 'W') { e.preventDefault(); if (v) { v.currentTime = Math.min(v.currentTime + 5, v.duration);  showToast('+5초'); } }
    else if (e.key === 's' || e.key === 'S') { e.preventDefault(); if (v) { v.currentTime = Math.max(v.currentTime - 5, 0);            showToast('-5초'); } }
    else if (e.key === ' ')                  { e.preventDefault(); if (v) v.paused ? v.play() : v.pause(); }
});

/* ═══════════════════════════════════════════
   ZIP 업로드
═══════════════════════════════════════════ */
document.getElementById('zipInput').addEventListener('change', async e => {
    const file = e.target.files[0];
    if (!file) return;
    try {
        const JSZip = await loadJSZip();
        const zip   = await JSZip.loadAsync(file);
        const txtFiles = [];
        zip.forEach((path, entry) => {
            if (!entry.dir && path.toLowerCase().endsWith('.txt')) txtFiles.push({ path, entry });
        });
        if (!txtFiles.length) { alert('ZIP 안에 TXT 파일이 없습니다.'); return; }
        tree = {};
        document.getElementById('main-container').innerHTML = '';
        let pending = txtFiles.length, totalImg = 0, totalVid = 0;
        txtFiles.forEach(({ path, entry }) => {
            entry.async('string').then(text => {
                const parts     = path.split('/');
                const groupName = parts.length >= 3 ? parts[parts.length - 2] : '(최상위)';
                const txtName   = parts[parts.length - 1].replace(/\.txt$/i, '');
                const data      = parseTxt(text);
                if (!tree[groupName]) tree[groupName] = {};
                tree[groupName][txtName] = data;
                totalImg += data.images.length;
                totalVid += data.videos.length;
                if (--pending === 0) renderTree(totalImg, totalVid);
            });
        });
    } catch (err) { alert('ZIP 처리 실패: ' + err.message); }
    e.target.value = '';
});

function loadJSZip() {
    return new Promise((resolve, reject) => {
        if (window.JSZip) { resolve(window.JSZip); return; }
        const s = document.createElement('script');
        s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
        s.onload  = () => resolve(window.JSZip);
        s.onerror = () => reject(new Error('JSZip 로드 실패'));
        document.head.appendChild(s);
    });
}

/* ═══════════════════════════════════════════
   붙여넣기 모달
═══════════════════════════════════════════ */
function openPasteModal() {
    document.getElementById('paste-modal').style.display = 'flex';
    setTimeout(() => document.getElementById('paste-area').focus(), 100);
}
function closePasteModal() {
    document.getElementById('paste-modal').style.display = 'none';
    document.getElementById('paste-area').value = '';
    document.getElementById('paste-name').value = '';
}
function submitPaste() {
    const text = document.getElementById('paste-area').value.trim();
    if (!text) { alert('내용을 붙여넣어 주세요.'); return; }
    const name = document.getElementById('paste-name').value.trim() || '붙여넣기';
    const data = parseTxt(text);
    if (!data.images.length && !data.videos.length) { alert('미디어 URL을 찾지 못했습니다.'); return; }
    if (!tree['(붙여넣기)']) tree['(붙여넣기)'] = {};
    tree['(붙여넣기)'][name] = data;
    const totalImg = Object.values(tree['(붙여넣기)']).reduce((s, d) => s + d.images.length, 0);
    const totalVid = Object.values(tree['(붙여넣기)']).reduce((s, d) => s + d.videos.length, 0);
    renderTree(totalImg, totalVid);
    closePasteModal();
}

/* ═══════════════════════════════════════════
   파일 입력 & 드래그 앤 드롭
═══════════════════════════════════════════ */
document.getElementById('folderInput').addEventListener('change', e => {
    processFiles(Array.from(e.target.files));
});

document.body.addEventListener('dragover', e => { e.preventDefault(); document.body.classList.add('drag-over'); });
document.body.addEventListener('dragleave', e => { if (!e.relatedTarget) document.body.classList.remove('drag-over'); });
document.body.addEventListener('drop', e => {
    e.preventDefault(); document.body.classList.remove('drag-over');
    const items    = Array.from(e.dataTransfer.items);
    const allFiles = [];
    if (!items.length && e.dataTransfer.files.length) { processFiles(Array.from(e.dataTransfer.files)); return; }
    let pending = items.length;
    function tryProc() { if (pending === 0) processFiles(allFiles); }
    function readDir(dir, done) {
        dir.createReader().readEntries(entries => {
            let sub = entries.length;
            if (!sub) { done(); return; }
            entries.forEach(ent => {
                if (ent.isFile) ent.file(f => {
                    Object.defineProperty(f, 'webkitRelativePath', { value: dir.fullPath.replace(/^\//, '') + '/' + f.name, writable: false });
                    allFiles.push(f);
                    if (--sub === 0) done();
                });
                else if (ent.isDirectory) readDir(ent, () => { if (--sub === 0) done(); });
                else if (--sub === 0) done();
            });
        });
    }
    items.forEach(item => {
        const entry = item.webkitGetAsEntry?.();
        if (!entry) { pending--; tryProc(); return; }
        if (entry.isFile)        entry.file(f => { allFiles.push(f); pending--; tryProc(); });
        else if (entry.isDirectory) readDir(entry, () => { pending--; tryProc(); });
        else { pending--; tryProc(); }
    });
});

/* ═══════════════════════════════════════════
   토스트
═══════════════════════════════════════════ */
let toastTimer;
function showToast(text) {
    let t = document.getElementById('_toast');
    if (!t) {
        t = document.createElement('div'); t.id = '_toast';
        t.style.cssText = 'position:fixed;bottom:36px;left:50%;transform:translateX(-50%);background:rgba(255,255,255,0.1);backdrop-filter:blur(8px);color:#fff;font-family:"Space Mono",monospace;font-size:12px;padding:6px 14px;border-radius:20px;border:1px solid rgba(255,255,255,0.12);z-index:3000;pointer-events:none;transition:opacity 0.2s;';
        document.body.appendChild(t);
    }
    t.textContent = text; t.style.opacity = '1';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.style.opacity = '0'; }, 900);
}
