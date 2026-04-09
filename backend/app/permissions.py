"""Коды прав (строки). Суперпользователь обходит все проверки."""

TASKS_CREATE = "tasks.create"
TASKS_READ_ALL = "tasks.read.all"
TASKS_READ_ASSIGNED = "tasks.read.assigned"
TASKS_UPDATE_ALL = "tasks.update.all"
TASKS_UPDATE_ASSIGNED = "tasks.update.assigned"
TASKS_DELETE = "tasks.delete"
TASKS_MOVE = "tasks.move"

BOARD_COLUMNS_MANAGE = "board.columns.manage"

SYSTEMS_MANAGE = "systems.manage"

POSITIONS_MANAGE = "positions.manage"

USERS_MANAGE = "users.manage"
ROLES_MANAGE = "roles.manage"

KNOWLEDGE_READ_ALL = "knowledge.read.all"
KNOWLEDGE_MANAGE_ALL = "knowledge.manage.all"
KNOWLEDGE_SPACE_MANAGE = "knowledge.space.manage"

EMPLOYEE_DIRECTORY_READ = "employee_directory.read"
EMPLOYEE_DIRECTORY_MANAGE = "employee_directory.manage"

ALL_PERMISSION_CODES: tuple[str, ...] = (
    TASKS_CREATE,
    TASKS_READ_ALL,
    TASKS_READ_ASSIGNED,
    TASKS_UPDATE_ALL,
    TASKS_UPDATE_ASSIGNED,
    TASKS_DELETE,
    TASKS_MOVE,
    BOARD_COLUMNS_MANAGE,
    SYSTEMS_MANAGE,
    POSITIONS_MANAGE,
    USERS_MANAGE,
    ROLES_MANAGE,
    KNOWLEDGE_READ_ALL,
    KNOWLEDGE_MANAGE_ALL,
    KNOWLEDGE_SPACE_MANAGE,
    EMPLOYEE_DIRECTORY_READ,
    EMPLOYEE_DIRECTORY_MANAGE,
)
