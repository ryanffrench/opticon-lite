# Start with the Kurento Media Server base image
FROM kurento/kurento-media-server:latest

# Expose the default Kurento Media Server port for WebRTC (TCP port 8888)
EXPOSE 8888

# Expose additional ports as needed for media streaming (e.g., RTP ports)
EXPOSE 5000-5050/udp

# Start the Kurento Media Server
CMD ["kurento-media-server"]
