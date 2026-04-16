"""
Разовый прогон: Заполняет в шаблоне эксель столбец СИСТЕМЫ для всех пользователей.
"""
import pandas as pd

FILE = "userData_example.xlsx"
OUTPUT = "userData_ex_заполнено.xlsx"

# 1. Читаем листы
df_map = pd.read_excel(FILE, sheet_name="Пользователи_Системы")
df_main = pd.read_excel(FILE, sheet_name="База_пользователей")

# 2. Чистим названия колонок от пробелов и переносов строк
df_map.columns = df_map.columns.map(str).str.strip()
df_main.columns = df_main.columns.map(str).str.strip()

print("> > > Пользователи_Системы колонки:", df_map.columns.tolist())
print("> > > База пользователей колонки:", df_main.columns.tolist())

# 3. Безопасно ищем нужные колонки (на случай, если в названии есть опечатка/пробел)
col_fio_map = next((c for c in df_map.columns if "фио" in c.lower()), None)
col_sys_map = next((c for c in df_map.columns if "систем" in c.lower()), None)
col_fio_main = next((c for c in df_main.columns if "фио" in c.lower()), None)

if not (col_fio_map and col_sys_map and col_fio_main):
    raise ValueError("❌ Не удалось найти колонки 'ФИО' или 'Системы'. Проверьте заголовки в Excel.")

# 4. Заполняем "дырки" от объединённых ячеек в справочнике
df_map[col_sys_map] = df_map[col_sys_map].ffill()

# 5. Создаём словарь маппинга и заполняем База пользователей
mapping = dict(zip(df_map[col_fio_map], df_map[col_sys_map]))
df_main["Системы"] = df_main[col_fio_main].map(mapping).fillna("")

# 6. Сохраняем результат
df_main.to_excel(OUTPUT, index=False)
print(f"> > > Готово! Файл сохранён: {OUTPUT}")