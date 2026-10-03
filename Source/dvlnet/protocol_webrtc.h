#pragma once

#include <chrono>
#include <expected>
#include <memory>
#include <optional>
#include <string>

#include <snps/transport.hpp>

#include "dvlnet/packet.h"

namespace devilution {
namespace net {

/**
 * @brief A transport for base_protocol that speaks WebRTC, through snps.
 *
 * Players find each other through a signalling server, which also carries the
 * out-of-band traffic: game info requests go to every player of the same
 * product and version, and the answers come back the same way. Everything
 * else goes over a reliable, ordered data channel to each peer.
 */
class protocol_webrtc {
public:
	class endpoint {
	public:
		/** @brief The peer id the signalling server gave that player. */
		snps::PeerId addr = {};

		explicit operator bool() const
		{
			return addr != snps::PeerId {};
		}

		bool operator==(const endpoint &rhs) const = default;

		buffer_t serialize() const
		{
			return buffer_t(addr.begin(), addr.end());
		}

		std::expected<void, PacketError> unserialize(const buffer_t &buf);
	};

	protocol_webrtc();
	~protocol_webrtc();

	void disconnect(const endpoint &peer);
	std::expected<void, PacketError> send(const endpoint &peer, const buffer_t &data);
	bool send_oob(const endpoint &peer, const buffer_t &data);
	bool send_oob_mc(const buffer_t &data);
	bool recv(endpoint &peer, buffer_t &data);
	bool get_disconnected(endpoint &peer);
	std::expected<bool, PacketError> network_online();
	std::expected<bool, PacketError> peers_ready();
	bool is_peer_connected(const endpoint &peer) const;
	std::optional<bool> is_peer_relayed(const endpoint &peer) const;
	std::optional<int> get_latency_to(const endpoint &peer) const;
	static std::string make_default_gamename();

private:
	std::string server_;
	std::unique_ptr<snps::Transport> transport_;
	std::chrono::steady_clock::time_point lastMulticast_;
};

} // namespace net
} // namespace devilution
