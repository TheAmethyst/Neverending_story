// Раздел «Gallery»: все фото — загруженные в галерею и прикреплённые
// к воспоминаниям и событиям — в виде полароидов.
(function () {
    'use strict';
    const { el } = ui;
    const PAGE = 60;

    const state = { items: [], done: false, stop: null, grid: null };

    async function fetchPage() {
        const rows = await api.select('photos', {
            select: 'id,path,thumb_path,width,height,memory_id,event_id,created_at',
            order: 'created_at.desc,id.desc',
            limit: String(PAGE),
            offset: String(state.items.length)
        });
        if (rows.length < PAGE) state.done = true;
        state.items.push(...rows);
        return rows;
    }

    async function appendTiles(rows) {
        if (!rows.length || !state.grid) return;
        let urls = {};
        try { urls = await api.signedUrls(rows.map((r) => r.thumb_path)); } catch (e) { ui.error(e); }
        const frag = document.createDocumentFragment();
        for (const p of rows) {
            frag.append(el('div', {
                class: 'gallery-item', dataset: { id: p.id }, role: 'button', tabindex: '0',
                onclick: () => open(p),
                onkeydown: (e) => { if (e.key === 'Enter') open(p); }
            }, el('img', { src: urls[p.thumb_path] || null, alt: '', loading: 'lazy', decoding: 'async' })));
        }
        state.grid.append(frag);
    }

    async function loadMore() {
        if (state.done) return false;
        await appendTiles(await fetchPage());
        return !state.done;
    }

    function open(p) {
        ui.lightbox(state.items, state.items.indexOf(p), {
            hasMore: () => !state.done,
            getMore: async () => {
                const before = state.items.length;
                await loadMore();
                return state.items.length > before;
            },
            onDelete: (item) => remove(item)
        });
    }

    async function remove(p) {
        const where = p.memory_id ? ' Оно прикреплено к воспоминанию и пропадёт оттуда тоже.'
            : p.event_id ? ' Оно прикреплено к событию таймлайна и пропадёт оттуда тоже.' : '';
        if (!(await ui.confirm('Удалить это фото навсегда?' + where))) return false;
        try {
            await images.deletePhoto(p);
            const i = state.items.indexOf(p);
            if (i >= 0) state.items.splice(i, 1);
            const node = state.grid && state.grid.querySelector(`[data-id="${p.id}"]`);
            if (node) node.remove();
            if (!state.items.length && state.done) renderEmpty();
            ui.toast('Фото удалено');
            return true;
        } catch (e) {
            ui.error(e);
            return false;
        }
    }

    function renderEmpty() {
        if (!app.isPage('gallery')) return;
        document.getElementById('content').replaceChildren(el('div', { class: 'empty-state' },
            el('p', { text: 'Галерея пуста' }),
            el('button', { type: 'button', class: 'btn-save-polaroid', text: 'Добавить фото', onclick: () => gallery.openForm() })
        ));
    }

    // ---------- форма загрузки ----------
    const modal = document.getElementById('galleryForm');
    const form = document.getElementById('galleryUploadForm');
    const errorBox = form.querySelector('.form-error');
    const submitBtn = form.querySelector('.btn-save-polaroid');
    const progress = form.querySelector('.upload-progress');
    const bar = form.querySelector('.upload-progress-bar');
    const picker = ui.photoPicker(form.querySelector('[data-photo-area]'));
    let uploading = false;

    async function tryClose() {
        if (uploading && !(await ui.confirm('Загрузка ещё идёт. Остановить?', 'Остановить'))) return;
        uploading = false;
        ui.closeModal(modal);
    }
    form.querySelector('[data-close]').addEventListener('click', tryClose);
    modal.addEventListener('click', (e) => { if (e.target === modal) tryClose(); });

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        errorBox.textContent = '';
        const files = picker.files;
        if (!files.length) { errorBox.textContent = 'Выбери хотя бы одно фото'; return; }

        uploading = true;
        const busy = ui.busy(submitBtn, 'Загрузка...');
        progress.hidden = false;
        bar.style.width = '0%';
        const failed = [];
        let added = 0;
        for (let i = 0; i < files.length; i++) {
            if (!uploading) break;
            busy.text(`Загрузка ${i + 1}/${files.length}...`);
            try {
                await images.addPhoto(files[i]);
                added++;
            } catch (err) {
                failed.push(`${files[i].name}: ${err.message}`);
            }
            bar.style.width = `${Math.round(((i + 1) / files.length) * 100)}%`;
        }
        const stopped = !uploading;
        uploading = false;
        busy.done();
        progress.hidden = true;

        if (failed.length) {
            errorBox.textContent = `Загружено ${added} из ${files.length}. Не получилось:\n` + failed.join('\n');
            picker.reset(null);
        } else if (!stopped) {
            ui.closeModal(modal);
            ui.toast(added === 1 ? 'Фото добавлено' : `Добавлено фото: ${added}`);
        }
        if (added && app.isPage('gallery')) gallery.show();
    });

    const gallery = {
        async show() {
            if (state.stop) state.stop();
            state.items = [];
            state.done = false;
            state.grid = null;
            const content = document.getElementById('content');
            content.replaceChildren(el('div', { class: 'loader', text: 'Загрузка фото...' }));
            let rows;
            try {
                rows = await fetchPage();
            } catch (e) {
                ui.error(e);
                content.replaceChildren(el('div', { class: 'empty-state' }, el('p', { text: 'Не получилось загрузить галерею' })));
                return;
            }
            if (!app.isPage('gallery')) return;
            if (!rows.length) return renderEmpty();
            state.grid = el('div', { class: 'gallery-grid' });
            const sentinel = el('div', { class: 'scroll-sentinel' });
            content.replaceChildren(state.grid, sentinel);
            await appendTiles(rows);
            if (!state.done) state.stop = ui.infinite(sentinel, loadMore);
        },

        leave() {
            if (state.stop) state.stop();
            state.stop = null;
            state.grid = null;
        },

        openForm() {
            errorBox.textContent = '';
            progress.hidden = true;
            picker.reset(null);
            ui.openModal(modal);
        }
    };

    window.gallery = gallery;
})();
