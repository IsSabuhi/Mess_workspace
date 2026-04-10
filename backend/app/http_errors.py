"""Короткие сообщения для HTTPException — на русском для отображения в UI."""


# Общие
FORBIDDEN = "Доступ запрещён"
NOT_AUTHENTICATED = "Выполните вход в систему"
PERMISSION_DENIED = "Недостаточно прав для этого действия"
SUPERUSER_REQUIRED = "Действие доступно только суперпользователю"

# Пользователи
USER_VIEW_FORBIDDEN = "Нет прав на просмотр этого пользователя"

# Авторизация
INVALID_CREDENTIALS = "Неверный email или пароль"
USER_INACTIVE = "Учётная запись отключена"
BOOTSTRAP_DISABLED = "Регистрация через bootstrap отключена"
USERS_ALREADY_EXIST = "Пользователи уже существуют — bootstrap недоступен"

# Профиль / справочники (PATCH /me и др.)
INVALID_POSITION = "Указана неверная должность"

# Пользователи (админ)
EMAIL_ALREADY_REGISTERED = "Этот email уже зарегистрирован"
UNKNOWN_ROLE = "Указана неизвестная роль"
UNKNOWN_SYSTEM = "Указана неизвестная система"
USER_NOT_FOUND = "Пользователь не найден"
DELETE_USER_SELF = "Нельзя удалить свою учётную запись"
DELETE_LAST_SUPERUSER = "Нельзя удалить последнего суперпользователя в системе"

# Задачи
TASK_SYSTEM_REQUIRED = "Укажите производственную систему"
TASK_NO_SYSTEM_MEMBERSHIP = (
    "Нет привязки к производственным системам — обратитесь к администратору"
)
TASK_PICK_SYSTEM = "Выберите производственную систему"
TASK_SYSTEM_NOT_ALLOWED = "Нет доступа к выбранной системе"
