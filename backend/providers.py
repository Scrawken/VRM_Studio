"""Modular AI & 3D Generation Provider Registry for Hybrid / Local / Cloud modes."""

import os
from abc import ABC, abstractmethod
from typing import Dict, List


class InterpreterProvider(ABC):
    provider_id: str

    @abstractmethod
    def is_configured(self) -> bool:
        ...


class GeminiInterpreterAdapter(InterpreterProvider):
    provider_id = "gemini-4-hydrogen"

    def is_configured(self) -> bool:
        key = os.environ.get("GEMINI_API_KEY", "")
        return bool(key and key != "MY_GEMINI_API_KEY")


class OllamaLocalAdapter(InterpreterProvider):
    provider_id = "ollama-local-llm"

    def __init__(self, host: str = "http://127.0.0.1:11434"):
        self.host = os.environ.get("OLLAMA_HOST", host)

    def is_configured(self) -> bool:
        return bool(self.host)


class LocalSemanticAdapter(InterpreterProvider):
    provider_id = "local-semantic-parser"

    def is_configured(self) -> bool:
        return True


class SculptedAnatomicalVrmAdapter(InterpreterProvider):
    provider_id = "sculpted-anatomical-vrm"

    def is_configured(self) -> bool:
        return True


class TripoAiAdapter(InterpreterProvider):
    provider_id = "tripo-ai-adapter"

    def is_configured(self) -> bool:
        return bool(os.environ.get("TRIPO_API_KEY", ""))


class MeshyAiAdapter(InterpreterProvider):
    provider_id = "meshy-ai-adapter"

    def is_configured(self) -> bool:
        return bool(os.environ.get("MESHY_API_KEY", ""))


class LocalTripoSrAdapter(InterpreterProvider):
    provider_id = "local-triposr-instantmesh"

    def is_configured(self) -> bool:
        return bool(os.environ.get("LOCAL_3D_URL", ""))


def get_provider_catalog() -> List[Dict[str, object]]:
    providers = [
        GeminiInterpreterAdapter(),
        OllamaLocalAdapter(),
        LocalSemanticAdapter(),
        SculptedAnatomicalVrmAdapter(),
        TripoAiAdapter(),
        MeshyAiAdapter(),
        LocalTripoSrAdapter(),
    ]
    return [
        {"id": p.provider_id, "configured": p.is_configured()}
        for p in providers
    ]
