// src/playerEvents.js
const { AudioPlayerStatus } = require('@discordjs/voice');

exports.playerEvents = (client) => {
  client.on('voiceStateUpdate', (oldState, newState) => {
    // If the bot is in a voice channel and the channel becomes empty, leave.
    const player = client.player;
    if (player && player.state.status !== AudioPlayerStatus.Idle) {
      if (oldState.member.user.bot) return; // Ignore bot's own voice state changes
      
      const channel = oldState.channel;
      if (channel && channel.members.filter(m => !m.user.bot).size === 0) {
        setTimeout(() => {
          if (channel.members.filter(m => !m.user.bot).size === 0) {
            client.player.stop();
            const connection = client.voice.connections.get(channel.guild.id);
            if (connection) {
              connection.destroy();
            }
          }
        }, 300000); // 5 minutes
      }
    }
  });
};
