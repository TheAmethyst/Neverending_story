// ===== 1. НАСТРОЙКА БАЗЫ ДАННЫХ =====
const { createClient } = window.supabase;

// 2. Явно записываем в window.db
window.db = createClient(
    'https://icdgotsozricuirxtfki.supabase.co', 
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImljZGdvdHNvenJpY3Vpcnh0ZmtpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzYzNDk1MzIsImV4cCI6MjA5MTkyNTUzMn0.vQBrXuY3qVyz4XYFmwSVtV3kfIQTYfM16LqmGm-QqFE'
);

// 3. Создаем локальную ссылку, чтобы функции внутри posts.js не сломались
const db = window.db;








// ===== 2. СЛУЖЕБНЫЕ ФУНКЦИИ =====
// Сжатие фото
window.compressImage = async function(file) {
    const options = {
        maxSizeMB: 0.5,
        maxWidthOrHeight: 1600,
        useWebWorker: true
    };
    try {
        return await imageCompression(file, options);
    } catch (error) {
        console.error("Ошибка сжатия:", error);
        return file;
    }
}





// ===== 3. ОСНОВНЫЕ ДЕЙСТВИЯ (ПОСТЫ) =====
// Загрузка постов
let currentSelectedYear = null;
window.loadPosts = async function() {
    const content = document.getElementById("content");
    if(content) content.innerHTML = "<div class='loader'>Синхронизируем хронологию...</div>";
    const { data, error } = await db.from("posts").select("*");
    if (error) {
        console.error(error);
        return;
    }
    // СОРТИРОВКА: От самого старого к самому новому (Задача №1)
    const sortedData = data.sort((a, b) => {
        const parseDate = (dateStr) => {
            const [d, m, y] = dateStr.split('.').map(Number);
            return new Date(y, m - 1, d);
        };
        return parseDate(a.date) - parseDate(b.date);
    });
    // ОПРЕДЕЛЕНИЕ ГОДА ПО УМОЛЧАНИЮ (Задача №3)
    if (!currentSelectedYear && sortedData.length > 0) {
        // Берем самый большой (последний по хронологии) год из имеющихся
        currentSelectedYear = Math.max(...sortedData.map(p => p.year));
    }
    // Сохраняем все посты глобально, чтобы фильтровать без новых запросов к БД
    window.allPosts = sortedData;
    updateYearsMenu(sortedData);
    renderFilteredPosts();
    if (currentSelectedYear && typeof window.updateBackground === 'function') {
        window.updateBackground(currentSelectedYear);
    }
};

// Добавление поста
window.addPost = async function() {
    // 1. ПОЛУЧАЕМ ДАННЫЕ (Убрали проверку isGalleryMode)
    const dateInput = document.getElementById("postDate").value;
    const textInput = document.getElementById("postText").value;
    const fileInput = document.getElementById("postImage").files[0];
    const saveBtn = document.getElementById("saveBtn");

    // 2. ВАЛИДАЦИЯ (Только для обычных постов)
    if (!dateInput || !textInput) {
        alert("Пожалуйста, заполни дату и текст");
        return;
    }

    if (saveBtn) {
        saveBtn.disabled = true;
        saveBtn.textContent = "Загрузка...";
    }

    let imageUrl = "";
    try {
        // 3. ЗАГРУЗКА ФОТО
        if (fileInput) {
            const compressed = await compressImage(fileInput);
            const fileName = `${Date.now()}_${fileInput.name}`;
            const { error: uploadError } = await db.storage
                .from("post-images")
                .upload(fileName, compressed);
            if (uploadError) throw uploadError;

            const { data: urlData } = await db.storage
                .from("post-images")
                .getPublicUrl(fileName);
            imageUrl = urlData.publicUrl;
        }

        // 4. СОХРАНЕНИЕ В ТАБЛИЦУ
        const year = dateInput.split(".")[2] || "2026";
        const { error: insertError } = await db.from("posts").insert([
            { 
                date: dateInput, 
                text: textInput, 
                image: imageUrl, 
                year: parseInt(year),
            }
        ]);
        if (insertError) throw insertError;

        // 5. ЗАКРЫТИЕ ФОРМЫ
        if (typeof closeForm === 'function') closeForm();

        // 6. ОБНОВЛЕНИЕ ЭКРАНА (Упростили логику)
        const panel = document.getElementById("yearsPanel");
        const isHistoryPage = panel && panel.style.display === "block";

        if (isHistoryPage) {
            window.loadPosts(); // Обновляем ленту, если мы в истории
        } else {
            document.getElementById("content").innerHTML = ""; // Очищаем, если на главной
        }

    } catch (err) {
        console.error("Критическая ошибка добавления:", err);
        alert("Ошибка: " + err.message);
    } finally {
        if (saveBtn) {
            saveBtn.disabled = false;
            saveBtn.textContent = "Сохранить";
        }
    }
};

// удаление поста
window.deletePost = async function(id, imageUrl) {
    if (!confirm("Удалить это воспоминание навсегда?")) return;

    try {
        // 1. УДАЛЕНИЕ ИЗ STORAGE
        // Внутри deletePost, замени блок удаления из Storage на этот:
        if (imageUrl) {
            const cleanUrl = imageUrl.split('?')[0];
            // ТЕСТ: Выведем в консоль все файлы, которые БАЗА видит в бакете
            const { data: listFiles } = await db.storage.from("post-images").list();
            console.log("Файлы, которые реально есть в Storage:", listFiles.map(f => f.name));
            const bucketName = "post-images/";
            const fileName = cleanUrl.slice(cleanUrl.lastIndexOf(bucketName) + bucketName.length);
            console.log("Мы пытаемся удалить это:", fileName);
            const { data: delData, error: storageError } = await db.storage
                .from("post-images")
                .remove([fileName]);

            if (storageError) console.error("Ошибка:", storageError);
            else console.log("Результат:", delData);
        }
        // 2. УДАЛЕНИЕ ИЗ ТАБЛИЦЫ
        const { error: tableError } = await db.from("posts").delete().eq("id", id);
        if (tableError) throw tableError;
        window.loadPosts();
    } catch (err) {
        console.error("Ошибка:", err);
    }
};





// СОРТИРОВКА ЛЕНТЫ ПОСТОВ
function renderFilteredPosts() {
    const content = document.getElementById("content");
    if (!content) return;
    content.innerHTML = "";
    const filtered = window.allPosts.filter(p => p.year === currentSelectedYear);
    filtered.forEach(p => {
        const div = document.createElement("div");
        div.className = "post-card"; // Базовый класс
        if (p.image) {
            const img = new Image();
            img.src = p.image;
            img.onload = function() {
                // Определяем ориентацию: если высота > ширины
                if (img.height > img.width) {
                    div.classList.add("portrait-mode");
                } else {
                    div.classList.add("landscape-mode");
                }
                // Рендерим содержимое в зависимости от мода
                renderCardHTML(div, p, true);
            };
        } else {
            // Если фото нет
            renderCardHTML(div, p, false);
        }
        content.appendChild(div);
    });
}

// Вспомогательная функция, чтобы не дублировать код
function renderCardHTML(container, p, hasImage) {
    const isPortrait = container.classList.contains("portrait-mode");
    const imageHTML = hasImage ? `<div class="post-media"><img src="${p.image}" loading="lazy"></div>` : '';
    // Создаем внутреннюю структуру
    // Сначала идет основной контент (дата + текст + фото), а потом кнопка
    container.innerHTML = `
        <div class="card-main-row">
            ${isPortrait ? imageHTML : ''} 
            <div class="post-content">
                <span class="handwritten-date">${p.date || ''}</span>
                <p class="handwritten-text">${p.text || ''}</p>
                ${!isPortrait && hasImage ? imageHTML : ''}
            </div>
        </div>
        <button class="delete-btn-simple" onclick="deletePost(${p.id}, '${p.image || ''}')">удалить</button>
    `;
}

// Панель годов
function updateYearsMenu(posts) {
    const yearsPanel = document.getElementById("yearsPanel");
    if (!yearsPanel) return;
    yearsPanel.innerHTML = "<h3>Years</h3>";
    const years = [...new Set(posts.map(p => p.year))].sort((a, b) => a - b);
    years.forEach(year => {
        const yearBtn = document.createElement("div");
        yearBtn.className = `year-link ${year === currentSelectedYear ? 'active' : ''}`;
        yearBtn.innerText = year;
        yearBtn.onclick = () => {
            currentSelectedYear = year;
            if (window.updateBackground) window.updateBackground(year);
            updateYearsMenu(posts); 
            renderFilteredPosts();  
        };
        yearsPanel.appendChild(yearBtn);
    });
}