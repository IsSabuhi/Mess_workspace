from pydantic import BaseModel, ConfigDict, Field, model_validator


class ReleaseNotePublishIn(BaseModel):
    version: str = Field(..., min_length=1, max_length=64)
    title: str = Field(..., min_length=1, max_length=255)
    body: str | None = Field(
        default=None,
        description="Свободный текст релиза (опционально). Если переданы структурные поля, body можно не указывать.",
    )
    summary: str | None = Field(default=None, max_length=1000, description="Короткое описание релиза.")
    whats_new: list[str] = Field(default_factory=list, description="Список пунктов для блока «Что нового».")
    improvements: list[str] = Field(default_factory=list, description="Список улучшений/доработок.")
    notes: list[str] = Field(default_factory=list, description="Важные заметки и комментарии.")
    links: list[str] = Field(default_factory=list, description="Ссылки (документация, тикеты, инструкции).")

    model_config = ConfigDict(
        json_schema_extra={
            "example": {
                "version": "v1.2",
                "title": "🚀 Большое обновление MES-портала: аудит, аналитика и Kanban",
                "summary": "Крупный релиз по аналитике, правам и общему аудиту.",
                "whats_new": [
                    "📊 Обновили аналитику задач: топ-10 + Прочие, таблица по всем системам.",
                    "🧩 Вынесли настройки системной доски в отдельную страницу.",
                    "🔐 Исправили права Editor на системных досках.",
                ],
                "improvements": [
                    "🛡️ Добавили общий журнал аудита в Администрировании.",
                    "🧭 Разделили «Уведомления» и «Новости» на отдельные вкладки.",
                ],
                "notes": [
                    "Если список «Что нового» пустой, блок в уведомлении не выводится.",
                ],
                "links": [
                    "README: https://example.com/readme",
                ],
            }
        }
    )

    @model_validator(mode="after")
    def validate_payload(self):
        has_structured = any(
            [
                bool((self.summary or "").strip()),
                len(self.whats_new) > 0,
                len(self.improvements) > 0,
                len(self.notes) > 0,
                len(self.links) > 0,
            ]
        )
        has_body = bool((self.body or "").strip())
        if not has_body and not has_structured:
            raise ValueError("Передайте body или хотя бы один структурный блок релиза.")
        return self
