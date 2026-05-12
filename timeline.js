// ==========================================
// 1. УПРАВЛЕНИЕ ОКНОМ (МОДАЛКОЙ)
// ==========================================

// Открытие формы добавления события
window.openTimelineModal = () => {
    const modal = document.getElementById('timelineModal');
    if (modal) modal.style.display = 'flex';
};

// Закрытие формы и очистка полей
window.closeTimelineModal = () => {
    const modal = document.getElementById('timelineModal');
    if (modal) modal.style.display = 'none';
    
    // Сброс полей ввода
    document.getElementById('timelineDate').value = '';
    document.getElementById('timelineTitle').value = '';
    document.getElementById('timelineDesc').value = '';
    document.getElementById('timelineFile').value = '';
    
    // Сброс превью картинки
    document.getElementById('timelineImgPreview').src = '';
    document.getElementById('timelineImgPreview').style.display = 'none';
    document.getElementById('timelinePreviewPlaceholder').style.display = 'block';
};

// Превью выбранной картинки перед загрузкой
window.previewTimelineImg = (input) => {
    if (input.files && input.files[0]) {
        const reader = new FileReader();
        reader.onload = (e) => {
            const img = document.getElementById('timelineImgPreview');
            img.src = e.target.result;
            img.style.display = 'block';
            document.getElementById('timelinePreviewPlaceholder').style.display = 'none';
        };
        reader.readAsDataURL(input.files[0]);
    }
};

// ==========================================
// 2. РАБОТА С ДАННЫМИ (ЗАГРУЗКА И ОТРИСОВКА)
// ==========================================

window.loadTimeline = async function() {
    updateDynamicHeader('timeline');
    const { data, error } = await window.db
        .from('timeline')
        .select('*')
        .order('event_date', { ascending: true });

    const content = document.getElementById("content");
    // Очищаем контент и создаем обертку
    content.innerHTML = '<div class="timeline-wrapper" id="timelineList"></div>';
    const list = document.getElementById("timelineList");

    // Используем индекс (i), чтобы чередовать стороны
    for (let i = 0; i < data.length; i++) {
        const event = data[i];
        const div = document.createElement("div");
        div.className = "timeline-event";

        // Форматирование даты
        const dateParts = event.event_date.split('-');
        const formattedDate = `${dateParts[2]}.${dateParts[1]}.${dateParts[0]}`;

        let imageHTML = '';
        let isVertical = false;

        if (event.image_url) {
            const checkImg = new Image();
            checkImg.src = event.image_url;
            try {
                await checkImg.decode();
                isVertical = checkImg.height > checkImg.width;
                imageHTML = `<img src="${event.image_url}" class="${isVertical ? 'timeline-img-vertical' : 'timeline-img-horizontal'}">`;
            } catch (e) {
                console.error("Ошибка загрузки фото", e);
            }
        }

        // ПОДГОТОВКА HTML КАРТОЧКИ (вынесли в переменную для удобства)
        const cardHTML = `
            <div class="timeline-card">
                <button class="timeline-delete-btn" onclick="window.deleteEvent(${event.id})">&times;</button>
                <div class="timeline-main-content">
                    ${isVertical ? imageHTML : ''}
                    <div class="timeline-text-side">
                        <h3 style="margin:0;">${event.title}</h3>
                        <p style="margin:5px 0 0; font-size:0.9rem; color:#666;">${event.description || ''}</p>
                    </div>
                </div>
                ${!isVertical && event.image_url ? imageHTML : ''}
            </div>
        `;

        // ГЛАВНОЕ ИЗМЕНЕНИЕ: Распределяем карточку по колонкам
        // Если i четное (0, 2, 4) — карточка в left-side
        // Если i нечетное (1, 3, 5) — карточка в right-side
        div.innerHTML = `
            <div class="timeline-date-badge">${formattedDate}</div>
            <div class="left-side">
                ${i % 2 === 0 ? cardHTML : ''}
            </div>
            <div class="right-side">
                ${i % 2 !== 0 ? cardHTML : ''}
            </div>
        `;

        list.appendChild(div);
    }
};

// ==========================================
// 3. СОХРАНЕНИЕ НОВОГО СОБЫТИЯ
// ==========================================

window.saveTimelineEvent = async function() {
    const dateInput = document.getElementById('timelineDate').value;
    const titleInput = document.getElementById('timelineTitle').value;
    const descInput = document.getElementById('timelineDesc').value;
    const fileInput = document.getElementById('timelineFile').files[0];
    const saveBtn = document.getElementById('saveTimelineBtn');

    // Простая проверка обязательных полей
    if (!dateInput || !titleInput) {
        return alert("Пожалуйста, укажите дату и заголовок события!");
    }

    // Блокируем кнопку на время загрузки
    if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.textContent = "Сохранение...";
    }

    try {
        let imageUrl = null;

        // Если прикреплено фото — сжимаем и загружаем в Storage
        if (fileInput) {
            // Используем функцию compressImage из posts.js
            const compressedFile = await window.compressImage(fileInput);
            const fileName = `timeline_${Date.now()}_${fileInput.name}`;
            
            const { error: storageError } = await window.db.storage
                .from('post-images')
                .upload(fileName, compressedFile);
            
            if (storageError) throw storageError;

            // Получаем публичную ссылку на фото
            const { data: urlData } = window.db.storage.from('post-images').getPublicUrl(fileName);
            imageUrl = urlData.publicUrl;
        }

        // Записываем данные в таблицу 'timeline'
        const { error: insertError } = await window.db.from('timeline').insert([{
            event_date: dateInput,
            title: titleInput,
            description: descInput,
            image_url: imageUrl
        }]);

        if (insertError) throw insertError;

        // Если всё успешно — закрываем форму и обновляем экран
        window.closeTimelineModal();
        
        // Если пользователь сейчас на странице таймлайна — обновляем список
        const isTimelinePage = !!document.getElementById('timelineList');
        if (isTimelinePage) {
            window.loadTimeline();
        } else {
            alert("Событие сохранено!");
        }

    } catch (err) {
        console.error("Критическая ошибка сохранения:", err);
        alert("Не удалось сохранить событие. Попробуйте еще раз.");
    } finally {
        if (saveBtn) {
            saveBtn.disabled = false;
            saveBtn.textContent = "сохранить событие";
        }
    }
};

// ==========================================
// 4. УДАЛЕНИЕ СОБЫТИЯ
// ==========================================

window.deleteEvent = async function(id) {
    if (!confirm("Вы уверены, что хотите удалить это событие из линии времени?")) return;

    const { error } = await window.db.from('timeline').delete().eq('id', id);
    
    if (error) {
        console.error("Ошибка удаления:", error);
        alert("Ошибка при удалении.");
    } else {
        window.loadTimeline();
    }
};