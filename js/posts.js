// Раздел «Notes»: воспоминания по годам — карусель карточек и пост целиком.
(function () {
    'use strict';
    const { el } = ui;

    const state = {
        all: [],          // все воспоминания (текст лёгкий, грузим разом)
        year: null,
        editing: null,
        track: null
    };

    const yearOf = (m) => Number(m.happened_on.slice(0, 4));
    const photoOf = (m) => (m.photos && m.photos[0]) || null;
    const byDate = (a, b) => a.happened_on.localeCompare(b.happened_on) || a.id - b.id;

    function introOf(text) {
        const words = (text || '').split(/\s+/).filter(Boolean);
        return words.slice(0, 5).join(' ') + (words.length > 5 ? '...' : '');
    }

    async function fetchAll() {
        state.all = await api.select('memories', {
            select: 'id,happened_on,title,body,created_by,photos(id,path,thumb_path,width,height)',
            order: 'happened_on.asc,id.asc'
        });
    }

    function years() {
        return [...new Set(state.all.map(yearOf))].sort((a, b) => a - b);
    }

    // ---------- панель годов ----------
    function renderYears() {
        const panel = document.getElementById('yearsPanel');
        panel.replaceChildren();
        for (const y of years()) {
            panel.append(el('button', {
                type: 'button',
                class: 'year-link' + (y === state.year ? ' active' : ''),
                'aria-current': y === state.year ? 'true' : null,
                text: String(y),
                onclick: () => {
                    if (y === state.year) return;
                    state.year = y;
                    renderYears();
                    renderCarousel();
                }
            }));
        }
        panel.hidden = !app.isPage('notes') || years().length === 0;
        const active = panel.querySelector('.active');
        if (active && ui.isMobile()) active.scrollIntoView({ block: 'nearest', inline: 'center' });
    }

    // ---------- карусель ----------
    function card(m, url) {
        const photo = photoOf(m);
        return el('div', {
            class: photo ? 'post-card' : 'post-card no-image-card',
            role: 'button',
            tabindex: '0',
            dataset: { id: m.id },
            onclick: () => openFull(m),
            onkeydown: (e) => { if (e.key === 'Enter') openFull(m); }
        },
            photo ? el('img', { src: url || null, alt: '', loading: 'lazy', decoding: 'async' }) : null,
            el('div', { class: 'post-card-overlay' },
                m.title ? el('div', { class: 'post-card-title', text: m.title }) : null,
                el('div', { class: 'post-card-date', text: ui.formatDate(m.happened_on) }),
                el('div', { class: 'post-card-intro', text: introOf(m.body) })
            )
        );
    }

    async function renderCarousel() {
        const content = document.getElementById('content');
        if (!app.isPage('notes')) return;
        if (state.year) ui.setBackground(['background', String(state.year)]);
        const list = state.all.filter((m) => yearOf(m) === state.year);
        if (!list.length) {
            content.replaceChildren(el('div', { class: 'empty-state' },
                el('p', { text: 'Здесь пока нет воспоминаний' }),
                el('button', { type: 'button', class: 'btn-save-polaroid', text: 'Добавить первое', onclick: () => posts.openForm(null) })
            ));
            return;
        }
        let urls = {};
        try { urls = await api.signedUrls(list.map((m) => photoOf(m) && photoOf(m).path)); } catch (e) { ui.error(e); }
        if (!app.isPage('notes')) return;

        const track = el('div', { class: 'posts-track', id: 'postsContainer' });
        for (const m of list) track.append(card(m, photoOf(m) ? urls[photoOf(m).path] : null));
        const step = () => (track.firstElementChild ? track.firstElementChild.offsetWidth + 30 : 380);
        const wrapper = el('div', { class: 'carousel-wrapper', id: 'dynamicCarousel' },
            el('button', { type: 'button', class: 'carousel-arrow left-arrow', 'aria-label': 'Назад', text: '❮', onclick: () => track.scrollBy({ left: -step(), behavior: 'smooth' }) }),
            track,
            el('button', { type: 'button', class: 'carousel-arrow right-arrow', 'aria-label': 'Вперёд', text: '❯', onclick: () => track.scrollBy({ left: step(), behavior: 'smooth' }) })
        );
        ui.wheelToHorizontal(track, wrapper, 1.5);
        content.replaceChildren(wrapper);
        state.track = track;
    }

    // ---------- пост целиком ----------
    const fullModal = document.getElementById('fullPostModal');
    const fullBody = document.getElementById('fullPostBody');
    fullModal.querySelector('[data-close]').addEventListener('click', () => ui.closeModal(fullModal));
    fullModal.addEventListener('click', (e) => { if (e.target === fullModal) ui.closeModal(fullModal); });

    async function openFull(m) {
        const photo = photoOf(m);
        fullBody.className = 'full-post-body';
        fullBody.style.width = '';
        fullBody.replaceChildren();

        let img = null;
        if (photo) {
            img = el('img', { alt: '', width: photo.width, height: photo.height, onclick: () => ui.lightbox([photo], 0) });
            fullBody.append(el('div', { class: 'full-post-image-container' }, img));
            if (photo.width > photo.height) {
                fullBody.classList.add('horizontal-layout');
                // ширина окна подстраивается под горизонтальное фото
                const imgH = window.innerHeight * 0.9 * 0.58;
                const w = Math.min(window.innerWidth * 0.9, Math.max(520, imgH * photo.width / photo.height + 20));
                if (!ui.isMobile()) fullBody.style.width = Math.round(w) + 'px';
            }
        } else {
            fullBody.classList.add('no-image-layout');
        }

        fullBody.append(el('div', { class: 'full-post-text-container' },
            el('div', { class: 'full-post-scroll-area' },
                m.title ? el('div', { class: 'full-post-title', text: m.title }) : null,
                el('div', { class: 'full-post-date', text: ui.formatDate(m.happened_on) }),
                el('div', { class: 'full-post-text', text: m.body })
            ),
            el('div', { class: 'delete-action-container post-delete-wrapper' },
                el('button', { type: 'button', class: 'micro-trigger-btn', 'aria-label': 'Действия', text: '⋮' }),
                el('div', { class: 'post-actions' },
                    el('button', { type: 'button', class: 'full-post-action', text: 'изменить', onclick: () => { ui.closeModal(fullModal); posts.openForm(m); } }),
                    el('button', { type: 'button', class: 'full-post-action', text: 'удалить', onclick: () => remove(m) })
                )
            )
        ));
        ui.openModal(fullModal);

        if (img) {
            try {
                const urls = await api.signedUrls([photo.thumb_path, photo.path]);
                img.src = urls[photo.path] || urls[photo.thumb_path];
            } catch (e) { ui.error(e); }
        }
    }

    async function remove(m) {
        const ok = await ui.confirm('Удалить это воспоминание навсегда? Его фото тоже удалится.');
        if (!ok) return;
        try {
            const photo = photoOf(m);
            await api.remove('memories', m.id);      // строка фото удалится каскадом
            if (photo) api.removeFiles([photo.path, photo.thumb_path]).catch(() => {});
            ui.closeModal(fullModal);
            state.all = state.all.filter((x) => x.id !== m.id);
            if (!state.all.some((x) => yearOf(x) === state.year)) {
                const ys = years();
                state.year = ys.length ? ys[ys.length - 1] : null;
            }
            renderYears();
            renderCarousel();
            ui.toast('Воспоминание удалено');
        } catch (e) { ui.error(e); }
    }

    // ---------- форма ----------
    const modal = document.getElementById('postModal');
    const form = document.getElementById('postForm');
    const dateInput = document.getElementById('postDate');
    const titleInput = document.getElementById('postTitle');
    const textInput = document.getElementById('postText');
    const errorBox = form.querySelector('.form-error');
    const submitBtn = form.querySelector('.btn-save-polaroid');
    const picker = ui.photoPicker(form.querySelector('[data-photo-area]'));

    function isDirty() {
        const ed = state.editing;
        if (picker.dirty) return true;
        if (ed) return titleInput.value !== (ed.title || '') || textInput.value !== ed.body || dateInput.value !== ed.happened_on;
        return !!(titleInput.value.trim() || textInput.value.trim());
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
        const happened_on = dateInput.value;
        const title = titleInput.value.trim();
        const body = textInput.value.trim();
        if (!happened_on || !body) { errorBox.textContent = 'Пожалуйста, заполни дату и текст'; return; }

        const busy = ui.busy(submitBtn, 'Сохранение...');
        const editing = state.editing;
        let uploaded = null;
        try {
            // сначала фото: если оно не откроется, ничего не сохранится
            if (picker.file) {
                busy.text('Сжимаю фото...');
                const prepared = await images.prepare(picker.file);
                busy.text('Загружаю фото...');
                uploaded = await images.uploadPrepared(prepared);
            }
            busy.text('Сохранение...');

            let saved;
            if (editing) {
                saved = await api.update('memories', editing.id, { happened_on, title, body });
                const old = photoOf(editing);
                if (old && (uploaded || picker.removed)) await images.deletePhoto(old);
            } else {
                saved = await api.insert('memories', { happened_on, title, body });
            }

            let photo = editing && !(uploaded || picker.removed) ? photoOf(editing) : null;
            if (uploaded) {
                try {
                    photo = await api.insert('photos', Object.assign({ memory_id: saved.id }, uploaded));
                } catch (err) {
                    if (!editing) await api.remove('memories', saved.id).catch(() => {});
                    throw err;
                }
                uploaded = null;
            }
            saved.photos = photo ? [photo] : [];

            const i = state.all.findIndex((x) => x.id === saved.id);
            if (i >= 0) state.all[i] = saved; else state.all.push(saved);
            state.all.sort(byDate);

            ui.closeModal(modal);
            ui.toast(editing ? 'Изменения сохранены' : 'Воспоминание сохранено');
            if (app.isPage('notes')) {
                state.year = yearOf(saved);
                renderYears();
                renderCarousel();
            }
        } catch (err) {
            if (uploaded) api.removeFiles([uploaded.path, uploaded.thumb_path]).catch(() => {});
            errorBox.textContent = err.message || 'Не удалось сохранить';
        } finally {
            busy.done();
        }
    });

    const posts = {
        async show() {
            const content = document.getElementById('content');
            content.replaceChildren(el('div', { class: 'loader', text: 'Синхронизация...' }));
            try {
                await fetchAll();
            } catch (e) {
                ui.error(e);
                content.replaceChildren(el('div', { class: 'empty-state' }, el('p', { text: 'Не получилось загрузить воспоминания' })));
                return;
            }
            if (!app.isPage('notes')) return;
            const ys = years();
            if (!ys.includes(state.year)) state.year = ys.length ? ys[ys.length - 1] : null;
            renderYears();
            renderCarousel();
        },

        leave() {
            document.getElementById('yearsPanel').hidden = true;
            state.track = null;
        },

        openForm(m) {
            state.editing = m || null;
            errorBox.textContent = '';
            dateInput.value = m ? m.happened_on : ui.todayIso();
            titleInput.value = m ? (m.title || '') : '';
            textInput.value = m ? m.body : '';
            submitBtn.textContent = m ? 'Сохранить' : 'Опубликовать';
            picker.reset(null);
            const p = m && photoOf(m);
            if (p) {
                api.signedUrls([p.path]).then((u) => {
                    if (state.editing === m && !picker.dirty) picker.reset(u[p.path]);
                }).catch(() => {});
            }
            ui.openModal(modal);
        }
    };

    window.posts = posts;
})();
