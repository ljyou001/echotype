#!/usr/bin/env python3
"""Test backend catalog loading - Run from project root"""

import sys
import logging
from pathlib import Path

# Get project root (parent of scripts directory)
script_dir = Path(__file__).parent
project_root = script_dir.parent

# Add backend to path
sys.path.insert(0, str(project_root / "backend"))

from backend.common.config import BackendConfig
from backend.manager import BackendManager

def main():
    logging.basicConfig(level=logging.INFO)
    logger = logging.getLogger("test")
    
    logger.info("Project root: %s", project_root)
    
    # Create config
    config = BackendConfig(
        models_dir=str(project_root / "models"),
        backend="sherpa_onnx",
        model_id="paraformer-offline"
    )
    
    # Create manager
    manager = BackendManager(config, logger=logger)
    
    # Test list_models_catalog
    logger.info("Testing list_models_catalog()...")
    result = manager.list_models_catalog()
    
    logger.info("Result keys: %s", result.keys())
    logger.info("Catalog length: %d", len(result.get("catalog", [])))
    
    for entry in result.get("catalog", []):
        logger.info("\nModel: %s", entry["id"])
        logger.info("  Has config: %s", "config" in entry)
        if "config" in entry:
            logger.info("  Config keys: %s", list(entry["config"].keys()))
            if "model" in entry["config"]:
                logger.info("  Description: %s", entry["config"]["model"].get("description", "(none)"))
            if "languages" in entry["config"]:
                logger.info("  Languages: %s", entry["config"]["languages"].get("available", "(none)"))
            if "devices" in entry["config"]:
                logger.info("  Devices: %s", entry["config"]["devices"].get("available", "(none)"))
        else:
            logger.warning("  ⚠️ NO CONFIG!")

if __name__ == "__main__":
    main()
