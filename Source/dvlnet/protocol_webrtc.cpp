#include "dvlnet/protocol_webrtc.h"

#include <algorithm>
#include <format>
#include <random>
#include <string_view>
#include <utility>

#include "options.h"
#include "utils/log.hpp"

namespace devilution {
namespace net {

namespace {

// The signalling server only lets peers of the same product and version see
// each other. Whether two builds can play together is checked by DevilutionX
// itself, the same as with ZeroTier, so the version only changes when the way
// this adapter uses the transport does.
constexpr std::string_view Product = "DVLX";
constexpr int ProtocolVersion = 1;

// While joining, base_protocol asks for game info every 10 ms. The server
// takes 30 messages a second from a connection, signalling included.
constexpr std::chrono::milliseconds MulticastInterval { 500 };

// The transport drops datagrams past these limits. A lost turn desyncs the
// game, so they are set far above what a game is expected to queue.
constexpr size_t InboxLimit = 65536;
constexpr size_t HeldLimit = 4096;

void LogTransport(snps::LogLevel level, const std::string &message)
{
	switch (level) {
	case snps::LogLevel::Debug:
		LogDebug("WebRTC: {}", message);
		break;
	case snps::LogLevel::Info:
		Log("WebRTC: {}", message);
		break;
	case snps::LogLevel::Warning:
		LogWarn("WebRTC: {}", message);
		break;
	case snps::LogLevel::Error:
		LogError("WebRTC: {}", message);
		break;
	}
}

} // namespace

std::expected<void, PacketError> protocol_webrtc::endpoint::unserialize(const buffer_t &buf)
{
	if (buf.size() != addr.size())
		return std::unexpected(PacketError(std::format("Endpoint deserialization expected {} bytes, got {}", addr.size(), buf.size())));
	std::copy(buf.begin(), buf.end(), addr.begin());
	return {};
}

protocol_webrtc::protocol_webrtc()
    : server_(GetOptions().Network.szWebRTCServer)
{
	snps::setLogSink(LogTransport);
	snps::initialize();

	snps::Options options;
	options.server = server_;
	options.product = Product;
	options.version = ProtocolVersion;
	// Whoever is master answers game info requests, and players introduced by
	// the host connect to each other directly. So every player has to be
	// reachable, not only the one who created the game.
	options.open = true;
	options.inboxLimit = InboxLimit;
	options.heldLimit = HeldLimit;
	transport_ = std::make_unique<snps::Transport>(std::move(options));
	transport_->start();
}

protocol_webrtc::~protocol_webrtc()
{
	transport_ = nullptr;
	snps::shutdown();
}

std::expected<bool, PacketError> protocol_webrtc::network_online()
{
	switch (transport_->status()) {
	case snps::Status::Online:
		return true;
	case snps::Status::Offline:
		return std::unexpected(PacketError(std::format("{} ({})", transport_->error(), server_)));
	default:
		return false;
	}
}

std::expected<bool, PacketError> protocol_webrtc::peers_ready()
{
	// Not an error while offline: the game list polls this every frame, and
	// network_online() reports the reason when it matters.
	return transport_->status() == snps::Status::Online;
}

std::expected<void, PacketError> protocol_webrtc::send(const endpoint &peer, const buffer_t &data)
{
	if (!transport_->send(peer.addr, snps::Channel::Reliable, data.data(), data.size()))
		return std::unexpected(PacketError(std::format("Not connected to the WebRTC server ({})", server_)));
	return {};
}

bool protocol_webrtc::send_oob(const endpoint &peer, const buffer_t &data)
{
	return transport_->sendViaServer(peer.addr, data.data(), data.size());
}

bool protocol_webrtc::send_oob_mc(const buffer_t &data)
{
	const auto now = std::chrono::steady_clock::now();
	if (now - lastMulticast_ < MulticastInterval)
		return true;
	lastMulticast_ = now;
	return transport_->multicast(data.data(), data.size());
}

bool protocol_webrtc::recv(endpoint &peer, buffer_t &data)
{
	snps::Datagram datagram;
	if (!transport_->receive(datagram))
		return false;
	peer.addr = datagram.from;
	data = std::move(datagram.data);
	return true;
}

bool protocol_webrtc::get_disconnected(endpoint &peer)
{
	return transport_->lost(peer.addr);
}

void protocol_webrtc::disconnect(const endpoint &peer)
{
	if (peer)
		transport_->disconnect(peer.addr);
}

bool protocol_webrtc::is_peer_connected(const endpoint &peer) const
{
	return transport_->connected(peer.addr);
}

std::optional<bool> protocol_webrtc::is_peer_relayed(const endpoint & /*peer*/) const
{
	return std::nullopt;
}

std::optional<int> protocol_webrtc::get_latency_to(const endpoint & /*peer*/) const
{
	return std::nullopt;
}

std::string protocol_webrtc::make_default_gamename()
{
	constexpr std::string_view AllowedChars = "abcdefghkopqrstuvwxyz";
	std::random_device rd;
	std::uniform_int_distribution<size_t> dist(0, AllowedChars.size() - 1);
	std::string ret;
	for (size_t i = 0; i < 5; ++i)
		ret += AllowedChars[dist(rd)];
	return ret;
}

} // namespace net
} // namespace devilution
