from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path, PurePosixPath

for parent in Path(__file__).resolve().parents:
    backend_root = parent / "MultiMix-Backend"
    if backend_root.joinpath("app", "db.py").exists():
        sys.path.insert(0, str(backend_root))
        break
else:
    raise RuntimeError("Cannot locate MultiMix-Backend for demo seed")

from sqlalchemy import create_engine
from sqlalchemy.engine import make_url
from sqlalchemy.orm import Session

from app.db import Base
from app.models import AssetConversation, AssetConversationMessage, ContentAsset, Plan, User, utcnow

SCENARIOS = {
    "01": ("厨房全屋定制", 4, 0),
    "02": ("护肤品种草", 3, 0),
    "03": ("Webb 科普", 6, 2),
    "04": ("门窗隔音素材缺口", 5, 4),
}


def validate_database(database_url: str) -> Path:
    url = make_url(database_url)
    if url.drivername != "sqlite" or not url.database:
        raise ValueError("Demo seed requires SQLite")
    raw = str(url.database).replace("\\", "/")
    pure = PurePosixPath(raw)
    if not pure.is_absolute() and not (len(raw) > 2 and raw[1:3] == ":/"):
        raise ValueError("Demo seed requires an absolute path")
    resolved = Path(raw).resolve()
    if not resolved.name.startswith("multimix-demo-") or resolved.name == "changein.sqlite3":
        raise ValueError("Demo seed requires a multimix-demo temporary database")
    return resolved


def understanding(label: str, role: str = "process") -> dict:
    return {
        "version": "multimix_asset_understanding_v1",
        "status": "ready",
        "source": "demo_seed",
        "tags": [label, "演示素材"],
        "caption": f"{label}的确定性演示素材。",
        "objects": [label],
        "storyboard_roles": [{"code": role, "label": "过程", "score": 0.95}],
        "scene_types": [{"code": "worker_operation", "label": "操作", "score": 0.9}],
        "fit_reason": f"适合{label}相关分镜。",
        "confidence": 0.95,
    }


def seed(database_url: str) -> dict:
    database_path = validate_database(database_url)
    database_path.parent.mkdir(parents=True, exist_ok=True)
    engine = create_engine(database_url)
    Base.metadata.create_all(engine)
    try:
        with Session(engine) as db:
            plan = Plan(code="demo-material-e2e", name="Demo material E2E", monthly_checks=1000, monthly_interpretations=1000, rendered_checks=1000, retention_days=1)
            db.add(plan); db.flush()
            user = User(email="demo-material-e2e@multimix.local", password_hash="fixture", locale="zh", region="cn", is_admin=True, plan_id=plan.id, email_verified_at=utcnow())
            db.add(user); db.flush()
            conversation_ids: dict[str, str] = {}
            asset_ids: dict[str, int] = {}
            for scenario_id, (title, scene_count, gap_count) in SCENARIOS.items():
                primary = ContentAsset(user_id=user.id, library_kind="image", asset_kind="image", content_type="uploaded_image", title=f"{scenario_id} 主素材", status="ready", source_type="upload", generation_state="source", original_ref=f"local://demo-{scenario_id}-primary.jpg", body=f"{title}主素材", metadata_json={"understanding": understanding(title)}, source_mapping=[], linked_asset_ids=[], linked_event_ids=[])
                distractor = ContentAsset(user_id=user.id, library_kind="image", asset_kind="image", content_type="uploaded_image", title=f"{scenario_id} 干扰素材", status="ready", source_type="upload", generation_state="source", original_ref=f"local://demo-{scenario_id}-distractor.jpg", body=f"{title}干扰素材", metadata_json={"understanding": understanding("错误语义干扰")}, source_mapping=[], linked_asset_ids=[], linked_event_ids=[])
                db.add_all([primary, distractor]); db.flush()
                scenes = []
                for index in range(scene_count):
                    is_gap = index >= scene_count - gap_count
                    reference = {"status": "no_asset_hit", "chosen_asset_id": None, "candidate_asset_ids": [], "match_confidence": 0.0, "match_reason": "本场景无对应已保存素材。"} if is_gap else {"status": "matched", "chosen_asset_id": primary.id, "candidate_asset_ids": [primary.id], "match_confidence": 0.92, "match_reason": "命中本场景主素材。", "source_snapshot": {"title": primary.title}}
                    scenes.append({"id": f"scene-{index + 1}", "title": f"分镜 {index + 1}", "narration": f"{title}确定性口播 {index + 1}", "visual_brief": f"{title}画面 {index + 1}", "subtitle_focus": f"重点 {index + 1}", "duration_seconds": 5, "asset_reference": reference, "material_candidates": [] if is_gap else [{"source_type": "saved_asset", "asset_id": primary.id, "title": primary.title}], "mg_decision": {"mode": "overlay", "needed": index == 0, "status": "planned" if index == 0 else "not_needed", "chosen_template": "data_card" if index == 0 else "", "reason": "演示数据需标注" if index == 0 else "本镜无需 MG"}})
                metadata = {"demo_scenario_id": scenario_id, "capability": "video_script", "capability_label": "编导文稿", "video_workflow_stage": "director_script_draft", "director_script_requires_confirmation": True, "video_plan": {"topic": title, "duration_seconds": scene_count * 5, "scenes": scenes}, "video_segments": scenes, "distractor_asset_ids": [distractor.id]}
                director = ContentAsset(user_id=user.id, library_kind="video", asset_kind="video", content_type="video_script", title=f"{scenario_id} {title}编导稿", status="draft", source_type="generated", generation_state="draft", body=f"# {title}编导稿\n\n确定性稳定回归夹具。", metadata_json=metadata, source_mapping=[{"source_type": "upload", "asset_id": primary.id}], linked_asset_ids=[primary.id], linked_event_ids=[])
                db.add(director); db.flush()
                conversation = AssetConversation(public_id=f"demo-material-{scenario_id}", user_id=user.id, title=f"场景 {scenario_id} {title}", status="active", metadata_json={"demo_scenario_id": scenario_id}, created_at=utcnow(), updated_at=utcnow())
                db.add(conversation); db.flush()
                db.add_all([AssetConversationMessage(conversation_id=conversation.id, user_id=user.id, role="user", text=f"打开场景 {scenario_id}", metadata_json={}, created_at=utcnow()), AssetConversationMessage(conversation_id=conversation.id, user_id=user.id, role="assistant", text="已生成可编辑编导稿。", asset_id=director.id, metadata_json={}, created_at=utcnow())])
                conversation_ids[scenario_id] = conversation.public_id
                asset_ids[scenario_id] = director.id
            db.commit()
            return {"user_email": user.email, "conversation_ids": conversation_ids, "asset_ids": asset_ids}
    finally:
        engine.dispose()


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--database-url", required=True)
    args = parser.parse_args()
    print(json.dumps(seed(args.database_url), ensure_ascii=False, separators=(",", ":")))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
