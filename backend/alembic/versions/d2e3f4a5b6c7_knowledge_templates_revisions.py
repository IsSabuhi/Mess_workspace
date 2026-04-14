"""knowledge templates and article revisions

Revision ID: d2e3f4a5b6c7
Revises: c9d0e1f2a3b4
Create Date: 2026-04-14

"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "d2e3f4a5b6c7"
down_revision: Union[str, None] = "c9d0e1f2a3b4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "knowledge_article_revisions",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("article_id", sa.UUID(), nullable=False),
        sa.Column("space_id", sa.UUID(), nullable=False),
        sa.Column("title", sa.String(length=512), nullable=False),
        sa.Column("content", sa.Text(), nullable=True),
        sa.Column(
            "status",
            postgresql.ENUM("draft", "published", name="article_status", create_type=False),
            nullable=False,
        ),
        sa.Column("parent_id", sa.UUID(), nullable=True),
        sa.Column("saved_by_id", sa.UUID(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["article_id"], ["knowledge_articles.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["space_id"], ["knowledge_spaces.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["saved_by_id"], ["users.id"], ondelete="SET NULL"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        op.f("ix_knowledge_article_revisions_article_id"),
        "knowledge_article_revisions",
        ["article_id"],
        unique=False,
    )
    op.create_index(
        op.f("ix_knowledge_article_revisions_space_id"),
        "knowledge_article_revisions",
        ["space_id"],
        unique=False,
    )

    op.create_table(
        "knowledge_templates",
        sa.Column("id", sa.UUID(), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("slug", sa.String(length=128), nullable=False),
        sa.Column("content", sa.Text(), nullable=True),
        sa.Column("space_id", sa.UUID(), nullable=True),
        sa.Column("created_by_id", sa.UUID(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(["created_by_id"], ["users.id"], ondelete="SET NULL"),
        sa.ForeignKeyConstraint(["space_id"], ["knowledge_spaces.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("space_id", "slug", name="uq_knowledge_template_slug_per_space"),
    )


def downgrade() -> None:
    op.drop_table("knowledge_templates")
    op.drop_index(op.f("ix_knowledge_article_revisions_space_id"), table_name="knowledge_article_revisions")
    op.drop_index(op.f("ix_knowledge_article_revisions_article_id"), table_name="knowledge_article_revisions")
    op.drop_table("knowledge_article_revisions")
