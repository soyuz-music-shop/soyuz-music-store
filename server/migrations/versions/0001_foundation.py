from alembic import op
import sqlalchemy as sa
revision = '0001_foundation'
down_revision = None
branch_labels = None
depends_on = None

def upgrade():
    op.create_table('worker_heartbeat', sa.Column('id', sa.Integer, primary_key=True), sa.Column('seen_at', sa.DateTime(timezone=True), nullable=False), schema='store')

def downgrade():
    op.drop_table('worker_heartbeat', schema='store')
