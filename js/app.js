// Запуск сайта: вход, меню профиля, настройки аккаунта, переключение разделов.
(function () {
    'use strict';
    const { el } = ui;

    const PAGES = {
        // фон: общий background.jpg из нового дизайна, а если его нет — картинки раздела
        home: { show: showHome, bg: ['main'] },
        notes: { show: () => posts.show(), leave: () => posts.leave(), bg: ['background'] },
        gallery: { show: () => gallery.show(), leave: () => gallery.leave(), bg: ['background', 'gallery_main'] },
        timeline: { show: () => timeline.show(), leave: () => timeline.leave(), bg: ['background', 'timeline'] }
    };
    const ALIASES = { history: 'notes', memories: 'notes' };

    const content = document.getElementById('content');
    const header = document.querySelector('header');
    const profile = document.querySelector('.profile-menu-container');
    const controls = document.getElementById('mainControls');
    const yearsPanel = document.getElementById('yearsPanel');

    let current = null;
    let members = {};

    const app = {
        isPage: (name) => current === name,
        memberName: (id) => (id && members[id] && members[id].display_name) || ''
    };
    window.app = app;

    // ---------- участники и аватар ----------
    async function loadMembers() {
        const rows = await api.select('members', { select: 'user_id,display_name,avatar_path' });
        members = {};
        for (const r of rows) members[r.user_id] = r;
        return !!(api.user && members[api.user.id]);
    }

    async function refreshAvatar() {
        const me = api.user && members[api.user.id];
        const path = me && me.avatar_path;
        const icon = document.getElementById('avatarIcon');
        const img = document.getElementById('avatarImage');
        const sIcon = document.getElementById('settingsAvatarIcon');
        const sImg = document.getElementById('settingsAvatarPreview');
        if (!path) {
            icon.hidden = sIcon.hidden = false;
            img.hidden = sImg.hidden = true;
            return;
        }
        try {
            const urls = await api.signedUrls([path]);
            img.src = sImg.src = urls[path];
            icon.hidden = sIcon.hidden = true;
            img.hidden = sImg.hidden = false;
        } catch (e) { /* аватар не критичен */ }
    }

    // ---------- вход ----------
    const loginModal = document.getElementById('loginModal');
    const loginError = document.getElementById('loginError');
    const loginBtn = document.getElementById('loginBtn');

    function showLogin(message) {
        if (current && PAGES[current].leave) PAGES[current].leave();
        current = null;
        document.body.dataset.page = 'login';
        header.hidden = true;
        profile.hidden = true;
        controls.hidden = true;
        yearsPanel.hidden = true;
        content.replaceChildren();
        document.querySelectorAll('.modal:not([hidden]), .full-image-overlay:not([hidden])').forEach((m) => ui.closeModal(m));
        loginError.textContent = message || '';
        ui.setBackground('main');
        ui.openModal(loginModal);
    }

    document.getElementById('loginForm').addEventListener('submit', async (e) => {
        e.preventDefault();
        loginError.textContent = '';
        const email = document.getElementById('loginEmail').value;
        const password = document.getElementById('loginPassword').value;
        if (!email || !password) { loginError.textContent = 'Укажите email и пароль'; return; }
        const busy = ui.busy(loginBtn, 'Вход...');
        try {
            await api.signIn(email, password);
            if (!(await loadMembers())) {
                await api.signOut();
                loginError.textContent = 'Вход выполнен, но этот аккаунт ещё не добавлен в участники сайта.';
                return;
            }
            document.getElementById('loginPassword').value = '';
            ui.closeModal(loginModal);
            refreshAvatar();
            route(true);
        } catch (err) {
            loginError.textContent = err.message;
        } finally {
            busy.done();
        }
    });

    api.onAuthLost = () => showLogin('Сессия закончилась, войдите заново');

    // ---------- меню профиля ----------
    const avatarBtn = document.getElementById('avatarBtn');
    const dropdown = document.getElementById('profileDropdown');
    const setMenu = (open) => {
        dropdown.classList.toggle('show', open);
        avatarBtn.setAttribute('aria-expanded', String(open));
    };
    avatarBtn.addEventListener('click', (e) => { e.stopPropagation(); setMenu(!dropdown.classList.contains('show')); });
    document.addEventListener('click', (e) => { if (!e.target.closest('.profile-menu-container')) setMenu(false); });

    document.getElementById('menuLogoutBtn').addEventListener('click', async () => {
        setMenu(false);
        if (!(await ui.confirm('Выйти с этого устройства?', 'Выйти'))) return;
        await api.signOut();
        showLogin();
    });

    // ---------- настройки аккаунта ----------
    const accountModal = document.getElementById('accountModal');
    const accountForm = document.getElementById('accountForm');
    const accountError = accountForm.querySelector('.form-error');
    const accountBtn = accountForm.querySelector('.btn-save-polaroid');
    const avatarInput = document.getElementById('avatarFileInput');
    const avatarText = document.getElementById('avatarUploadText');
    const avatarArea = document.getElementById('avatarUploadArea');

    document.getElementById('menuAccountBtn').addEventListener('click', () => {
        setMenu(false);
        accountError.textContent = '';
        document.getElementById('newEmail').value = '';
        document.getElementById('newPassword').value = '';
        avatarText.textContent = 'Изменить аватар';
        ui.openModal(accountModal);
    });
    accountForm.querySelector('[data-close]').addEventListener('click', () => ui.closeModal(accountModal));
    accountModal.addEventListener('click', (e) => { if (e.target === accountModal) ui.closeModal(accountModal); });

    avatarArea.addEventListener('click', () => avatarInput.click());
    avatarArea.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); avatarInput.click(); } });
    avatarInput.addEventListener('change', async () => {
        const file = avatarInput.files && avatarInput.files[0];
        avatarInput.value = '';
        if (!file) return;
        avatarText.textContent = 'Загрузка...';
        try {
            const me = members[api.user.id];
            const oldPath = me && me.avatar_path;
            const path = await images.uploadAvatar(file);
            await api.request(`/rest/v1/members?user_id=eq.${encodeURIComponent(api.user.id)}`, {
                method: 'PATCH', body: { avatar_path: path }
            });
            me.avatar_path = path;
            if (oldPath) api.removeFiles([oldPath]).catch(() => {});
            await refreshAvatar();
            avatarText.textContent = 'Аватар обновлён';
        } catch (err) {
            avatarText.textContent = 'Ошибка загрузки';
            ui.error(err);
        }
    });

    accountForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        accountError.textContent = '';
        const email = document.getElementById('newEmail').value.trim();
        const password = document.getElementById('newPassword').value;
        if (!email && !password) { accountError.textContent = 'Нет данных для обновления'; return; }
        if (password && password.length < 6) { accountError.textContent = 'Пароль должен быть не короче 6 символов'; return; }
        const busy = ui.busy(accountBtn, 'Обновление...');
        try {
            if (password) await api.updateUser({ password });
            if (email) await api.updateUser({ email });
            ui.closeModal(accountModal);
            ui.toast(email
                ? 'Готово. Чтобы сменить почту, подтвердите её по ссылке из письма.'
                : 'Пароль обновлён');
        } catch (err) {
            accountError.textContent = err.message;
        } finally {
            busy.done();
        }
    });

    // ---------- разделы ----------
    function showHome() {
        content.replaceChildren();
        controls.hidden = false;
    }

    function pageFromHash() {
        const raw = (location.hash || '').replace('#', '').toLowerCase();
        const name = ALIASES[raw] || raw;
        return PAGES[name] ? name : 'home';
    }

    let switchTimer = null;
    function route(force) {
        if (!api.signedIn) return showLogin();
        const name = pageFromHash();
        if (name === current && !force) return;
        const prev = current;
        if (prev && PAGES[prev].leave) PAGES[prev].leave();
        current = name;

        header.hidden = false;
        profile.hidden = false;
        document.body.dataset.page = name;
        document.querySelectorAll('.nav-btn[data-page]').forEach((a) => {
            const on = a.dataset.page === name;
            a.classList.toggle('active', on);
            if (on) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
        });
        controls.hidden = true;
        yearsPanel.hidden = true;
        ui.setBackground(PAGES[name].bg);

        content.classList.add('fade-out');
        clearTimeout(switchTimer);
        switchTimer = setTimeout(() => {
            window.scrollTo({ top: 0 });
            content.classList.remove('fade-out');
            PAGES[name].show();
        }, prev ? 250 : 0);
    }

    window.addEventListener('hashchange', () => route());
    document.getElementById('addMemoryBtn').addEventListener('click', () => posts.openForm(null));
    document.getElementById('addGalleryBtn').addEventListener('click', () => gallery.openForm());
    document.getElementById('addTimelineBtn').addEventListener('click', () => timeline.openForm(null));

    // ---------- старт ----------
    async function boot() {
        if (!api.signedIn) return showLogin();
        try {
            if (!(await loadMembers())) {
                await api.signOut();
                return showLogin('Этот аккаунт не добавлен в участники сайта.');
            }
        } catch (e) {
            if (!api.signedIn) return;
            document.body.dataset.page = 'error';
            ui.setBackground('main');
            content.replaceChildren(el('div', { class: 'empty-state' },
                el('p', { text: e.message }),
                el('button', { type: 'button', class: 'btn-save-polaroid', text: 'Попробовать ещё раз', onclick: () => location.reload() })
            ));
            return;
        }
        refreshAvatar();
        route();
    }

    boot();
})();
