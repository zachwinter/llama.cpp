#include "server-tools.h"
#include "server-http.h"
#include "server-common.h"

#include "arg.h"
#include "common.h"
#include "log.h"

#include <atomic>
#include <functional>
#include <signal.h>

static std::function<void(int)> shutdown_handler;
static std::atomic_flag is_terminating = ATOMIC_FLAG_INIT;

static inline void signal_handler(int signal) {
    if (is_terminating.test_and_set()) {
        fprintf(stderr, "Received second interrupt, terminating immediately.\n");
        exit(1);
    }
    shutdown_handler(signal);
}

static server_http_context::handler_t ex_wrapper(server_http_context::handler_t func) {
    return [func = std::move(func)](const server_http_req & req) -> server_http_res_ptr {
        std::string message;
        error_type error;
        try {
            return func(req);
        } catch (const std::invalid_argument & e) {
            error = ERROR_TYPE_INVALID_REQUEST;
            message = e.what();
        } catch (const std::exception & e) {
            error = ERROR_TYPE_SERVER;
            message = e.what();
        } catch (...) {
            error = ERROR_TYPE_SERVER;
            message = "unknown error";
        }

        auto res = std::make_unique<server_http_res>();
        res->status = 500;
        try {
            json error_data = format_error_response(message, error);
            res->status = json_value(error_data, "code", 500);
            res->data = safe_json_to_str({{ "error", error_data }});
            SRV_WRN("got exception: %s\n", res->data.c_str());
        } catch (const std::exception & e) {
            SRV_ERR("got another exception: %s | while handling exception: %s\n", e.what(), message.c_str());
            res->data = "Internal Server Error";
        }
        return res;
    };
}

// satisfies -Wmissing-declarations
int llama_tool_server(int argc, char ** argv);

int llama_tool_server(int argc, char ** argv) {
    common_params params;

    common_init();

    if (!common_params_parse(argc, argv, params, LLAMA_EXAMPLE_SERVER)) {
        return 1;
    }

    if (params.server_tools.empty()) {
        SRV_ERR("%s", "no tools specified; use --tools all or --tools TOOL1,TOOL2,...\n");
        return 1;
    }

    if (params.hostname != "127.0.0.1" && params.hostname != "localhost") {
        SRV_WRN("%s", "-----------------\n");
        SRV_WRN("binding to %s -- do not expose to untrusted environments\n", params.hostname.c_str());
        SRV_WRN("%s", "-----------------\n");
    }

    server_tools tools;
    try {
        tools.setup(params.server_tools);
    } catch (const std::exception & e) {
        SRV_ERR("tools setup failed: %s\n", e.what());
        return 1;
    }

    server_http_context ctx_http;
    if (!ctx_http.init(params)) {
        SRV_ERR("%s", "failed to initialize HTTP server\n");
        return 1;
    }

    ctx_http.get("/health", [](const server_http_req &) -> server_http_res_ptr {
        auto res = std::make_unique<server_http_res>();
        res->data = "{\"status\":\"ok\"}";
        return res;
    });
    ctx_http.get ("/tools", ex_wrapper(tools.handle_get));
    ctx_http.post("/tools", ex_wrapper(tools.handle_post));

    if (!ctx_http.start()) {
        SRV_ERR("%s", "exiting due to HTTP server error\n");
        return 1;
    }

    ctx_http.is_ready.store(true);
    SRV_INF("tool server is listening on %s\n", ctx_http.listening_address.c_str());

    shutdown_handler = [&](int) {
        ctx_http.stop();
    };

#if defined(__unix__) || (defined(__APPLE__) && defined(__MACH__))
    struct sigaction sigint_action;
    sigint_action.sa_handler = signal_handler;
    sigemptyset(&sigint_action.sa_mask);
    sigint_action.sa_flags = 0;
    sigaction(SIGINT,  &sigint_action, NULL);
    sigaction(SIGTERM, &sigint_action, NULL);
#elif defined(_WIN32)
    auto console_ctrl_handler = +[](DWORD ctrl_type) -> BOOL {
        return (ctrl_type == CTRL_C_EVENT) ? (signal_handler(SIGINT), true) : false;
    };
    SetConsoleCtrlHandler(reinterpret_cast<PHANDLER_ROUTINE>(console_ctrl_handler), true);
#endif

    if (ctx_http.thread.joinable()) {
        ctx_http.thread.join();
    }

    return 0;
}

int main(int argc, char ** argv) {
    return llama_tool_server(argc, argv);
}
