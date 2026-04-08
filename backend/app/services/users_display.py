from app.models import User
from app.schemas.position import PositionBrief
from app.schemas.system import SystemBrief
from app.schemas.user import RoleBrief, UserOut


def user_to_out(user: User) -> UserOut:
    roles = [RoleBrief.model_validate(ur.role) for ur in user.roles if ur.role]
    pos = PositionBrief.model_validate(user.position) if user.position else None
    systems = sorted(
        (SystemBrief.model_validate(us.system) for us in user.system_memberships if us.system),
        key=lambda s: s.name.lower(),
    )
    return UserOut(
        id=user.id,
        email=user.email,
        full_name=user.full_name,
        job_title=user.job_title,
        position=pos,
        birth_date=user.birth_date,
        is_active=user.is_active,
        is_superuser=user.is_superuser,
        created_at=user.created_at,
        updated_at=user.updated_at,
        roles=roles,
        systems=systems,
    )
