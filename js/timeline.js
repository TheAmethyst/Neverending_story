// Раздел «Timeline»: горизонтальная лента событий с круглыми фото.
(function () {
    'use strict';
    const { el } = ui;
    const PAGE = 15;
    const HEART = 'M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z';

    const state = { items: [], done: false, stop: null, list: null, sentinel: null, editing: null };
    const photoOf = (ev) => (ev.photos && ev.photos[0]) || null;

    async function fetchPage() {
        const rows = await api.select('events', {
            select: 'id,event_date,title,description,created_by,photos(id,path,thumb_path,width,height)',
            order: 'event_date.asc,id.asc',
            limit: String(PAGE),
            offset: String(state.items.length)
        });
        if (rows.length < PAGE) state.done = true;
        state.items.push(...rows);
        return rows;
    }

    function eventNode(ev, url) {
        const photo = photoOf(ev);
        const avatar = photo
            ? el('img', {
                class: 'timeline-avatar', src: url || null, alt: '', loading: 'lazy', decoding: 'async',
                onclick: (e) => { if (ui.canHover()) { e.stopPropagation(); ui.lightbox([photo], 0); } }
            })
            : el('div', { class: 'timeline-avatar empty-avatar' }, ui.svg('0 0 24 24', HEART, 'url(#heartGrad)'));

        const node = el('div', {
            class: 'timeline-event',
            dataset: { id: ev.id },
            onclick: (e) => {
                if (e.target.closest('.delete-action-container')) return;
                // на телефоне тап показывает дату (на компьютере она появляется при наведении)
                document.querySelectorAll('.timeline-event.show-date').forEach((x) => { if (x !== node) x.classList.remove('show-date'); });
                node.classList.toggle('show-date');
            }
        },
            el('div', { class: 'timeline-node' },
                el('div', { class: 'delete-action-container timeline-trigger-container' },
                    el('button', { type: 'button', class: 'micro-trigger-btn', 'aria-label': 'Действия', text: '⋮' }),
                    el('div', { class: 'timeline-actions' },
                        el('button', { type: 'button', class: 'timeline-action-btn', text: 'изменить', onclick: (e) => { e.stopPropagation(); timeline.openForm(ev); } }),
                        el('button', { type: 'button', class: 'timeline-action-btn timeline-delete-btn', text: 'удалить', onclick: (e) => { e.stopPropagation(); remove(ev); } })
                    )
                ),
                avatar,
                el('div', { class: 'timeline-date-overlay', text: ui.formatDate(ev.event_date) })
            ),
            el('div', { class: 'timeline-title-badge' }, el('span', { class: 'timeline-title-text', text: ev.title }))
        );
        return node;
    }

    async function appendEvents(rows) {
        if (!rows.length || !state.list) return;
        let urls = {};
        try { urls = await api.signedUrls(rows.map((r) => photoOf(r) && photoOf(r).thumb_path)); } catch (e) { ui.error(e); }
        const frag = document.createDocumentFragment();
        for (const ev of rows) frag.append(eventNode(ev, photoOf(ev) ? urls[photoOf(ev).thumb_path] : null));
        state.list.insertBefore(frag, state.sentinel);
    }

    async function loadMore() {
        if (state.done) return false;
        await appendEvents(await fetchPage());
        return !state.done;
    }

    async function remove(ev) {
        if (!(await ui.confirm('Вы уверены, что хотите удалить это событие из линии времени?'))) return;
        try {
            const photo = photoOf(ev);
            await api.remove('events', ev.id);
            if (photo) api.removeFiles([photo.path, photo.thumb_path]).catch(() => {});
            ui.toast('Событие удалено');
            if (app.isPage('timeline')) timeline.show({ keepScroll: true });
        } catch (e) { ui.error(e); }
    }

    // ---------- форма ----------
    const modal = document.getElementById('timelineModal');
    const form = document.getElementById('timelineForm');
    const dateInput = document.getElementById('timelineDate');
    const titleInput = document.getElementById('timelineTitle');
    const errorBox = form.querySelector('.form-error');
    const submitBtn = form.querySelector('.btn-save-polaroid');
    const picker = ui.photoPicker(form.querySelector('[data-photo-area]'));

    function isDirty() {
        const ed = state.editing;
        if (picker.dirty) return true;
        if (ed) return titleInput.value !== ed.title || dateInput.value !== ed.event_date;
        return !!titleInput.value.trim();
    }
    async function tryClose() {
        if (isDirty() && !(await ui.confirm('Закрыть без сохранения?', 'Закрыть'))) return;
        ui.closeModal(modal);
    }
    form.querySelector('[data-close]').addEventListener('click', tryClose);
    modal.addEventListener('click', (e) => { if (e.target === modal) tryClose(); });

    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        errorBox.textContent = '';
        const event_date = dateInput.value;
        const title = titleInput.value.trim();
        if (!event_date || !title) { errorBox.textContent = 'Пожалуйста, укажите дату и заголовок события'; return; }

        const busy = ui.busy(submitBtn, 'Сохранение...');
        const editing = state.editing;
        let uploaded = null;
        try {
            if (picker.file) {
                busy.text('Сжимаю фото...');
                const prepared = await images.prepare(picker.file);
                busy.text('Загружаю фото...');
                uploaded = await images.uploadPrepared(prepared);
            }
            busy.text('Сохранение...');

            let saved;
            if (editing) {
                saved = await api.update('events', editing.id, { event_date, title });
                const old = photoOf(editing);
                if (old && (uploaded || picker.removed)) await images.deletePhoto(old);
            } else {
                saved = await api.insert('events', { event_date, title });
            }
            if (uploaded) {
                try {
                    await api.insert('photos', Object.assign({ event_id: saved.id }, uploaded));
                } catch (err) {
                    if (!editing) await api.remove('events', saved.id).catch(() => {});
                    throw err;
                }
                uploaded = null;
            }

            ui.closeModal(modal);
            ui.toast(editing ? 'Изменения сохранены' : 'Событие сохранено');
            if (app.isPage('timeline')) timeline.show({ keepScroll: true });
        } catch (err) {
            if (uploaded) api.removeFiles([uploaded.path, uploaded.thumb_path]).catch(() => {});
            errorBox.textContent = err.message || 'Не удалось сохранить событие';
        } finally {
            busy.done();
        }
    });

    const timeline = {
        async show(opts) {
            const keep = !!(opts && opts.keepScroll);
            const scrollX = keep && state.list ? state.list.scrollLeft : 0;
            const prevCount = keep ? state.items.length : 0;
            if (state.stop) state.stop();
            state.items = [];
            state.done = false;
            const content = document.getElementById('content');
            if (!keep) content.replaceChildren(el('div', { class: 'loader', text: 'Загрузка событий...' }));

            let rows;
            try {
                rows = await fetchPage();
                while (keep && !state.done && state.items.length < prevCount) rows = rows.concat(await fetchPage());
            } catch (e) {
                ui.error(e);
                content.replaceChildren(el('div', { class: 'empty-state' }, el('p', { text: 'Не получилось загрузить события' })));
                return;
            }
            if (!app.isPage('timeline')) return;
            if (!rows.length) {
                state.list = null;
                content.replaceChildren(el('div', { class: 'empty-state' },
                    el('p', { text: 'Событий нет' }),
                    el('button', { type: 'button', class: 'btn-save-polaroid', text: 'Добавить первое', onclick: () => timeline.openForm(null) })
                ));
                return;
            }

            state.list = el('div', { class: 'timeline-wrapper', id: 'timelineList' });
            state.sentinel = el('span', { class: 'scroll-sentinel' });
            state.list.append(state.sentinel);
            const list = state.list;
            const step = (dir) => () => list.scrollBy({ left: dir * 450, behavior: 'smooth' });
            content.replaceChildren(
                el('button', { type: 'button', class: 'nav-arrow timeline-arrow left-arrow', 'aria-label': 'Назад', text: '❮', onclick: step(-1) }),
                list,
                el('button', { type: 'button', class: 'nav-arrow timeline-arrow right-arrow', 'aria-label': 'Вперёд', text: '❯', onclick: step(1) })
            );
            ui.wheelToHorizontal(list, list);
            await appendEvents(rows);
            if (scrollX) list.scrollLeft = scrollX;
            if (!state.done) state.stop = ui.infinite(state.sentinel, loadMore, list);
        },

        leave() {
            if (state.stop) state.stop();
            state.stop = null;
            state.list = null;
        },

        openForm(ev) {
            state.editing = ev || null;
            errorBox.textContent = '';
            dateInput.value = ev ? ev.event_date : ui.todayIso();
            titleInput.value = ev ? ev.title : '';
            submitBtn.textContent = ev ? 'Сохранить' : 'Опубликовать';
            picker.reset(null);
            const p = ev && photoOf(ev);
            if (p) {
                api.signedUrls([p.path]).then((u) => {
                    if (state.editing === ev && !picker.dirty) picker.reset(u[p.path]);
                }).catch(() => {});
            }
            ui.openModal(modal);
        }
    };

    window.timeline = timeline;
})();
