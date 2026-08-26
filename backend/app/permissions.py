"""Коды прав (строки). Суперпользователь обходит все проверки."""

TASKS_CREATE = "tasks.create"
TASKS_READ_ALL = "tasks.read.all"
TASKS_READ_ASSIGNED = "tasks.read.assigned"
TASKS_UPDATE_ALL = "tasks.update.all"
TASKS_UPDATE_ASSIGNED = "tasks.update.assigned"
TASKS_DELETE = "tasks.delete"
TASKS_MOVE = "tasks.move"

BOARD_COLUMNS_MANAGE = "board.columns.manage"
BOARDS_CREATE = "boards.create"

SYSTEMS_MANAGE = "systems.manage"

POSITIONS_MANAGE = "positions.manage"

USERS_MANAGE = "users.manage"
USERS_CREATE = "users.create"
USERS_PASSWORD_RESET = "users.password.reset"
USERS_DELETE = "users.delete"
ROLES_MANAGE = "roles.manage"

ADMIN_SETTINGS = "admin.settings.manage"
ADMIN_BACKUPS = "admin.backups.manage"
ADMIN_AUDIT = "admin.audit.read"
ADMIN_IMPORT_USERS = "admin.import.users"
ADMIN_IMPORT_TASKS = "admin.import.tasks"
ADMIN_IMPORT_VACATIONS = "admin.import.vacations"
ADMIN_IMPORT_KNOWLEDGE = "admin.import.knowledge"
ADMIN_IMPORT_USPD = "admin.import.uspd"

KNOWLEDGE_READ_ALL = "knowledge.read.all"
KNOWLEDGE_MANAGE_ALL = "knowledge.manage.all"
KNOWLEDGE_SPACE_MANAGE = "knowledge.space.manage"

EMPLOYEE_DIRECTORY_READ = "employee_directory.read"
EMPLOYEE_DIRECTORY_MANAGE = "employee_directory.manage"
# Узкие права: вкладка «Экзамены и пропуски» / вкладка «Кадровый справочник».
EMPLOYEE_DIRECTORY_COMPLIANCE_MANAGE = "employee_directory.compliance.manage"
EMPLOYEE_DIRECTORY_PROFILE_MANAGE = "employee_directory.profile.manage"
EMPLOYEE_DIRECTORY_COMPLIANCE_NOTIFICATIONS_RECEIVE = "employee_directory.compliance.notifications.receive"

SCHEDULE_READ = "schedule.read"
SCHEDULE_MANAGE = "schedule.manage"

ALL_PERMISSION_CODES: tuple[str, ...] = (
    TASKS_CREATE,
    TASKS_READ_ALL,
    TASKS_READ_ASSIGNED,
    TASKS_UPDATE_ALL,
    TASKS_UPDATE_ASSIGNED,
    TASKS_DELETE,
    TASKS_MOVE,
    BOARD_COLUMNS_MANAGE,
    BOARDS_CREATE,
    SYSTEMS_MANAGE,
    POSITIONS_MANAGE,
    USERS_MANAGE,
    USERS_CREATE,
    USERS_PASSWORD_RESET,
    USERS_DELETE,
    ROLES_MANAGE,
    ADMIN_SETTINGS,
    ADMIN_BACKUPS,
    ADMIN_AUDIT,
    ADMIN_IMPORT_USERS,
    ADMIN_IMPORT_TASKS,
    ADMIN_IMPORT_VACATIONS,
    ADMIN_IMPORT_KNOWLEDGE,
    ADMIN_IMPORT_USPD,
    KNOWLEDGE_READ_ALL,
    KNOWLEDGE_MANAGE_ALL,
    KNOWLEDGE_SPACE_MANAGE,
    EMPLOYEE_DIRECTORY_READ,
    EMPLOYEE_DIRECTORY_MANAGE,
    EMPLOYEE_DIRECTORY_COMPLIANCE_MANAGE,
    EMPLOYEE_DIRECTORY_PROFILE_MANAGE,
    EMPLOYEE_DIRECTORY_COMPLIANCE_NOTIFICATIONS_RECEIVE,
    SCHEDULE_READ,
    SCHEDULE_MANAGE,
)

# Любое из этих прав открывает раздел «Администрирование».
ADMIN_SECTION_CODES: tuple[str, ...] = (
    USERS_MANAGE,
    USERS_CREATE,
    USERS_PASSWORD_RESET,
    USERS_DELETE,
    ROLES_MANAGE,
    ADMIN_SETTINGS,
    ADMIN_BACKUPS,
    ADMIN_AUDIT,
    ADMIN_IMPORT_USERS,
    ADMIN_IMPORT_TASKS,
    ADMIN_IMPORT_VACATIONS,
    ADMIN_IMPORT_KNOWLEDGE,
    ADMIN_IMPORT_USPD,
)

USERS_STAFF_CODES: tuple[str, ...] = (
    USERS_MANAGE,
    USERS_CREATE,
    USERS_PASSWORD_RESET,
    USERS_DELETE,
)

# Права, которые нельзя выдать «выше своих» при назначении роли.
PRIVILEGED_ASSIGN_CODES: frozenset[str] = frozenset(ADMIN_SECTION_CODES)
