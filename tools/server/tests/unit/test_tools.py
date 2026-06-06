import os
import pytest
from utils import *

TOOL_SERVER_BIN = os.environ.get(
    "LLAMA_TOOL_SERVER_BIN_PATH",
    "../../../build/bin/llama-tool-server",
)

TOOL_SERVER_PORT = 8082


def _tool_server(port: int = TOOL_SERVER_PORT, tools: str = "get_datetime") -> ServerProcess:
    s = ServerProcess()
    s.server_path = TOOL_SERVER_BIN
    s.server_port = port
    s.model_hf_repo = None
    s.model_hf_file = None
    s.server_tools = tools
    return s


# standalone llama-tool-server tests

def test_tool_server_health():
    ts = _tool_server()
    ts.start()
    res = ts.make_request("GET", "/health")
    assert res.status_code == 200
    assert res.body.get("status") == "ok"


def test_tool_server_list_tools():
    ts = _tool_server(tools="get_datetime,read_file")
    ts.start()
    res = ts.make_request("GET", "/tools")
    assert res.status_code == 200
    names = {t["tool"] for t in res.body}
    assert names == {"get_datetime", "read_file"}


def test_tool_server_tool_has_definition():
    ts = _tool_server()
    ts.start()
    res = ts.make_request("GET", "/tools")
    assert res.status_code == 200
    assert len(res.body) == 1
    tool = res.body[0]
    assert tool["type"] == "builtin"
    assert "definition" in tool
    assert tool["definition"]["type"] == "function"


def test_tool_server_execute_tool():
    ts = _tool_server()
    ts.start()
    res = ts.make_request("POST", "/tools", data={"tool": "get_datetime", "params": {}})
    assert res.status_code == 200
    assert "result" in res.body


def test_tool_server_unknown_tool_error():
    ts = _tool_server()
    ts.start()
    res = ts.make_request("POST", "/tools", data={"tool": "nonexistent_tool", "params": {}})
    assert res.status_code == 200
    assert "error" in res.body
    assert "unknown tool" in res.body["error"]


def test_tool_server_missing_tool_field():
    ts = _tool_server()
    ts.start()
    res = ts.make_request("POST", "/tools", data={})
    assert res.status_code >= 400


# --tool-server-url proxy tests (two servers: llama-tool-server + llama-server)

def test_tool_server_url_not_configured_returns_404():
    ms = ServerProcess()
    ms.server_port = 8080
    ms.model_hf_repo = None
    ms.model_hf_file = None
    ms.start()
    res = ms.make_request("GET", "/tools")
    assert res.status_code == 404


def test_tool_server_url_proxy_list():
    ts = _tool_server(port=TOOL_SERVER_PORT, tools="get_datetime")
    ts.start()

    ms = ServerProcess()
    ms.server_port = 8080
    ms.model_hf_repo = None
    ms.model_hf_file = None
    ms.tool_server_url = f"http://{ts.server_host}:{ts.server_port}"
    ms.start()

    res = ms.make_request("GET", "/tools")
    assert res.status_code == 200
    names = {t["tool"] for t in res.body}
    assert names == {"get_datetime"}


def test_tool_server_url_proxy_execute():
    ts = _tool_server(port=TOOL_SERVER_PORT, tools="get_datetime")
    ts.start()

    ms = ServerProcess()
    ms.server_port = 8080
    ms.model_hf_repo = None
    ms.model_hf_file = None
    ms.tool_server_url = f"http://{ts.server_host}:{ts.server_port}"
    ms.start()

    res = ms.make_request("POST", "/tools", data={"tool": "get_datetime", "params": {}})
    assert res.status_code == 200
    assert "result" in res.body


def test_tool_server_url_filters_visible_tools():
    # tool server exposes only a subset; proxy should reflect that subset
    ts = _tool_server(port=TOOL_SERVER_PORT, tools="get_datetime")
    ts.start()

    ms = ServerProcess()
    ms.server_port = 8080
    ms.model_hf_repo = None
    ms.model_hf_file = None
    ms.tool_server_url = f"http://{ts.server_host}:{ts.server_port}"
    ms.start()

    res = ms.make_request("GET", "/tools")
    assert res.status_code == 200
    names = {t["tool"] for t in res.body}
    # only get_datetime; exec_shell_command and others must not appear
    assert "exec_shell_command" not in names
    assert "get_datetime" in names
