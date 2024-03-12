const { Client, GatewayIntentBits, MessageAttachment, EmbedBuilder } = require('discord.js');
const { SlashCommandBuilder } = require('@discordjs/builders');
const { REST } = require('@discordjs/rest');
const { Routes } = require('discord-api-types/v9');
const yaml = require('yaml');
const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
  ],
});

let config;
let db;
config = yaml.parse(fs.readFileSync('config.yml', 'utf8'));
db = new sqlite3.Database('assassin.db');

client.once('ready', () => {
  console.log('Assassin Bot is ready!');
  initializeDatabase();
});

function initializeDatabase() {

  // Create the game_state table
  db.run(`CREATE TABLE IF NOT EXISTS game_state (
    state TEXT DEFAULT 'lobby'
  )`);

  // Insert the default game state if it doesn't exist
  db.get('SELECT * FROM game_state', (err, row) => {
    if (!row) {
      db.run('INSERT INTO game_state (state) VALUES (?)', ['lobby']);
    }
  });

  db.run(`CREATE TABLE IF NOT EXISTS players (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    discord_id TEXT UNIQUE,
    name TEXT,
    team_id INTEGER,
    is_alive INTEGER DEFAULT 1,
    FOREIGN KEY (team_id) REFERENCES teams (id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS teams (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT,
    owner_id INTEGER,
    FOREIGN KEY (owner_id) REFERENCES players (id)
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS disputes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    submitter_id TEXT,
    dispute_text TEXT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS assassinations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    assassin_id TEXT,
    target_id TEXT,
    evidence_url TEXT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS kills (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    assassin_id TEXT,
    target_id TEXT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);

}

const commands = [
    new SlashCommandBuilder().setName('join').setDescription('Register for the game'),
    new SlashCommandBuilder().setName('create-team').setDescription('Create a new team').addStringOption(option => option.setName('name').setDescription('The name of the team').setRequired(true)),
    new SlashCommandBuilder().setName('join-team').setDescription('Request to join a team').addIntegerOption(option => option.setName('team').setDescription('The ID of the team to join').setRequired(true)),
    new SlashCommandBuilder().setName('leave-team').setDescription('Leave your current team'),
    new SlashCommandBuilder().setName('transfer-ownership').setDescription('Transfer team ownership to another player').addUserOption(option => option.setName('player').setDescription('The player to transfer ownership to').setRequired(true)),
    new SlashCommandBuilder().setName('kick-player').setDescription('Kick a player from your team').addUserOption(option => option.setName('player').setDescription('The player to kick').setRequired(true)),
    new SlashCommandBuilder().setName('start-game').setDescription('Start the game'),
    new SlashCommandBuilder()
      .setName('report-assassination')
      .setDescription('Report an assassination with evidence')
      .addUserOption(option => option.setName('target').setDescription('The player to assassinate').setRequired(true))
      .addAttachmentOption(option => option.setName('evidence').setDescription('Evidence of the assassination').setRequired(true)),
    new SlashCommandBuilder().setName('submit-dispute').setDescription('Submit a dispute for review').addStringOption(option => option.setName('dispute').setDescription('The details of the dispute').setRequired(true)),
    new SlashCommandBuilder().setName('resolve-dispute').setDescription('Resolve a dispute').addStringOption(option => option.setName('dispute_id').setDescription('The ID of the dispute to resolve').setRequired(true)).addStringOption(option => option.setName('resolution').setDescription('The resolution of the dispute').setRequired(true)),
    new SlashCommandBuilder().setName('leaderboard').setDescription('Display the current leaderboard'),
    new SlashCommandBuilder().setName('rules').setDescription('Display the game rules'),
    new SlashCommandBuilder().setName('player-list').setDescription('Display the list of players and their status'),
    new SlashCommandBuilder().setName('team-list').setDescription('Display the list of teams and their information'),
    new SlashCommandBuilder().setName('help').setDescription('Display the help message'),
    new SlashCommandBuilder().setName('eliminate').setDescription('Eliminate a player from the game (admin only)').addStringOption(option => option.setName('player_id').setDescription('The ID of the player to eliminate').setRequired(true)),
    new SlashCommandBuilder().setName('revive').setDescription('Revive a player in the game (admin only)').addStringOption(option => option.setName('player_id').setDescription('The ID of the player to revive').setRequired(true)),
  ];

const rest = new REST({ version: '9' }).setToken(config.bot.token);

(async () => {
try {
    console.log('Started refreshing application (/) commands.');

    await rest.put(
    Routes.applicationGuildCommands(config.bot.client_id, config.channels.guild_id),
    { body: commands },
    );

    console.log('Successfully reloaded application (/) commands.');
} catch (error) {
    console.error(error);
}
})();

client.on('interactionCreate', async (interaction) => {
    if (!interaction.isCommand()) return;
  
    const { commandName } = interaction;
  
    // Check if the game is in the lobby phase
    db.get('SELECT * FROM game_state', async (err, row) => {
      if (err) {
        console.error('Error checking game state:', err);
        return interaction.reply('An error occurred while processing the command. Please try again later.');
      }
  
      const gameState = row ? row.state : 'lobby';
  
      if (gameState === 'lobby') {
        if (
          commandName !== 'join' &&
          commandName !== 'create-team' &&
          commandName !== 'join-team' &&
          commandName !== 'leave-team' &&
          commandName !== 'transfer-ownership' &&
          commandName !== 'kick-player' &&
          commandName !== 'start-game' &&
          commandName !== 'rules' &&
          commandName !== 'player-list' &&
          commandName !== 'team-list' &&
          commandName !== 'help'
        ) {
          return interaction.reply('This command is not available during the lobby phase.');
        }
      }
  
    if (commandName === 'join') {
      await handlePlayerRegistration(interaction);
    } else if (commandName === 'create-team') {
      await handleTeamCreation(interaction);
    } else if (commandName === 'join-team') {
      await handleTeamJoining(interaction);
    } else if (commandName === 'leave-team') {
      await handleTeamLeaving(interaction);
    } else if (commandName === 'transfer-ownership') {
      await handleOwnershipTransfer(interaction);
    } else if (commandName === 'kick-player') {
      await handlePlayerKick(interaction);
    } else if (commandName === 'start-game') {
      await handleGameStart(interaction);
    } else if (commandName === 'report-assassination') {
      await handleAssassinationReport(interaction);
    } else if (commandName === 'submit-dispute') {
      await handleDisputeSubmission(interaction);
    } else if (commandName === 'resolve-dispute') {
      await handleDisputeResolution(interaction);
    } else if (commandName === 'leaderboard') {
      await displayLeaderboard(interaction);
    } else if (commandName === 'rules') {
      await displayRules(interaction);
    } else if (commandName === 'player-list') {
      await displayPlayerList(interaction);
    } else if (commandName === 'team-list') {
      await displayTeamList(interaction);
    } else if (commandName === 'help') {
      await displayHelp(interaction);
    } else if (commandName === 'eliminate') {
      await eliminatePlayer(interaction);
    } else if (commandName === 'revive') {
      await revivePlayer(interaction);
    }
  });
});

  function shuffle(array) {
    for (let i = array.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
  }
  
  async function handlePlayerRegistration(interaction) {
    const userId = interaction.user.id;
  
    db.get('SELECT state FROM game_state', async (err, row) => {
      if (err) {
        console.error('Error checking game state:', err);
        return interaction.reply('An error occurred while registering. Please try again later.');
      }
  
      if (row.state !== config.game.states.lobby) {
        return interaction.reply('The game has already started. Registration is not allowed at this time.');
      }
  
      db.get('SELECT * FROM players WHERE discord_id = ?', [userId], async (err, row) => {
        if (err) {
          console.error('Error checking player registration:', err);
          return interaction.reply('An error occurred while registering. Please try again later.');
        }
  
        if (row) {
          return interaction.reply('You are already registered for the game.');
        }
  
        const name = interaction.user.username;
  
        db.run('INSERT INTO players (discord_id, name) VALUES (?, ?)', [userId.toString(), name], async function (err) {
            if (err) {
              console.error('Error registering player:', err);
              return interaction.reply('An error occurred while registering. Please try again later.');
            }
        
            const playerId = this.lastID;
        
            if (config.game.allow_manual_approval) {
              const gameManagerRole = interaction.guild.roles.cache.get(config.roles.game_manager);
              const gameManagers = interaction.guild.members.cache.filter((member) => member.roles.cache.has(gameManagerRole.id));
        
              const embed = new EmbedBuilder()
                .setTitle('New Player Registration')
                .setDescription(`${interaction.user.username} has requested to join the game.`)
                .addFields(
                  { name: 'Player ID', value: playerId.toString() },
                  { name: 'Discord ID', value: userId }
                )
                .setTimestamp();
        
              const approveButton = new ButtonBuilder()
                .setCustomId(`approvePlayer_${playerId}`)
                .setLabel('Approve')
                .setStyle(ButtonStyle.Success);
        
              const rejectButton = new ButtonBuilder()
                .setCustomId(`rejectPlayer_${playerId}`)
                .setLabel('Reject')
                .setStyle(ButtonStyle.Danger);
        
              const actionRow = new ActionRowBuilder()
                .addComponents(approveButton, rejectButton);
        
              gameManagers.forEach((manager) => {
                manager.send({ embeds: [embed], components: [actionRow] });
              });
        
              interaction.reply('Your registration request has been submitted for manual approval. Please wait for a game manager to review your request.');
            } else {
              try {
                const playerRole = interaction.guild.roles.cache.get(config.roles.player);
                await interaction.member.roles.add(playerRole);
                interaction.reply(`You have been successfully registered for the game and assigned the player role! Your player ID is: ${playerId}`);
              } catch (error) {
                console.error('Error assigning player role:', error);
                interaction.reply('You have been successfully registered for the game, but there was an error assigning the player role. Please contact an admin.');
              }
            }
          });
        });
    }
);}

async function approvePlayer(interaction, playerId) {
    if (!isGameManager(interaction)) {
      return interaction.reply('Only game managers can approve player registration requests.');
    }
  
    db.get('SELECT * FROM players WHERE id = ?', [playerId], async (err, row) => {
      if (err) {
        console.error('Error fetching player:', err);
        return interaction.reply('An error occurred while approving the player. Please try again later.');
      }
  
      if (!row) {
        return interaction.reply('The specified player does not exist.');
      }
  
      try {
        const playerRole = interaction.guild.roles.cache.get(config.roles.player);
        const member = await interaction.guild.members.fetch(row.discord_id);
        await member.roles.add(playerRole);
        interaction.reply(`Player with ID ${playerId} has been approved and assigned the player role.`);
      } catch (error) {
        console.error('Error assigning player role:', error);
        interaction.reply('An error occurred while approving the player. Please try again later.');
      }
    });
  }
  
  async function rejectPlayer(interaction, playerId) {
    if (!isGameManager(interaction)) {
      return interaction.reply('Only game managers can reject player registration requests.');
    }
  
    db.run('DELETE FROM players WHERE id = ?', [playerId], (err) => {
      if (err) {
        console.error('Error rejecting player:', err);
        return interaction.reply('An error occurred while rejecting the player. Please try again later.');
      }
  
      interaction.reply(`Player with ID ${playerId} has been rejected.`);
    });
  }
  
  async function handleTeamCreation(interaction) {
    const userId = interaction.user.id;
  
    db.get('SELECT * FROM players WHERE discord_id = ?', [userId], (err, row) => {
      if (err) {
        console.error('Error checking player:', err);
        return interaction.reply('An error occurred while creating a team. Please try again later.');
      }
  
      if (!row) {
        return interaction.reply('You must be registered for the game to create a team.');
      }
  
      if (row.team_id) {
        return interaction.reply('You are already a member of a team. You cannot create a new team.');
      }
  
      const teamName = interaction.options.getString('name');
      const ownerId = row.discord_id;
  
      db.run('INSERT INTO teams (name, owner_id) VALUES (?, ?)', [teamName, ownerId], function(err) {
        if (err) {
          console.error('Error creating team:', err);
          return interaction.reply('An error occurred while creating a team. Please try again later.');
        }
  
        const teamId = this.lastID;
  
        db.run('UPDATE players SET team_id = ? WHERE id = ?', [teamId, row.id], (err) => {
          if (err) {
            console.error('Error updating player team:', err);
            return interaction.reply('An error occurred while creating a team. Please try again later.');
          }
  
          interaction.reply(`Team "${teamName}" has been created and you have been added as the owner!`);
        });
      });
    });
  }
  
  async function handleTeamJoining(interaction) {
    const userId = interaction.user.id;
    const teamId = interaction.options.getInteger('team');
  
    db.get('SELECT * FROM players WHERE discord_id = ?', [userId], (err, playerRow) => {
      if (err) {
        console.error('Error checking player:', err);
        return interaction.reply('An error occurred while joining a team. Please try again later.');
      }
  
      if (!playerRow) {
        return interaction.reply('You must be registered for the game to join a team.');
      }
  
      db.get('SELECT * FROM teams WHERE id = ?', [teamId], async (err, teamRow) => {
        if (err) {
          console.error('Error checking team:', err);
          return interaction.reply('An error occurred while joining a team. Please try again later.');
        }
  
        if (!teamRow) {
          return interaction.reply('The specified team does not exist.');
        }
  
        if (playerRow.team_id) {
          return interaction.reply('You are already a member of a team.');
        }
  
        const ownerId = BigInt(teamRow.owner_id);
        ownerId = ownerId.toString;
        console.log('Owner ID:', ownerId);

        try {
          const owner = client.users.fetch(ownerId);
  
          const embed = new EmbedBuilder()
            .setTitle('Team Join Request')
            .setDescription(`${interaction.user.username} has requested to join your team "${teamRow.name}".`)
            .setFooter({ text: 'Please use the buttons below to approve or reject the request.' });
  
          const approveButton = {
            type: 2,
            style: 3,
            label: 'Approve',
            custom_id: `joinapprove_${playerRow.id}_${teamId}`,
          };
  
          const rejectButton = {
            type: 2,
            style: 4,
            label: 'Reject',
            custom_id: `joinreject_${playerRow.id}_${teamId}`,
          };
  
          const actionRow = {
            type: 1,
            components: [approveButton, rejectButton],
          };
  
          await owner.send({ embeds: [embed], components: [actionRow] });
  
          await interaction.reply(`Your request to join team "${teamRow.name}" has been sent to the team owner.`);
        } catch (error) {
          console.error('Error sending join request to team owner:', error);
          await interaction.reply('An error occurred while sending the join request to the team owner. Please try again later.');
        }
      });
    });
  }
  
  async function handleTeamLeaving(interaction) {
    if (!isPlayer(interaction)) {
      return interaction.reply('Only players can leave a team.');
    }
    const userId = interaction.user.id;
  
    db.get('SELECT * FROM players WHERE discord_id = ?', [userId], (err, playerRow) => {
      if (err) {
        console.error('Error checking player:', err);
        return interaction.reply('An error occurred while leaving the team. Please try again later.');
      }
  
      if (!playerRow) {
        return interaction.reply('You are not registered for the game.');
      }
  
      if (!playerRow.team_id) {
        return interaction.reply('You are not a member of any team.');
      }
  
      const teamId = playerRow.team_id;
  
      db.get('SELECT * FROM teams WHERE id = ?', [teamId], (err, teamRow) => {
        if (err) {
          console.error('Error checking team:', err);
          return interaction.reply('An error occurred while leaving the team. Please try again later.');
        }
  
        if (!teamRow) {
          return interaction.reply('The specified team does not exist.');
        }
  
        if (teamRow.owner_id === playerRow.id) {
          // If the player is the team owner, transfer ownership to the next oldest member
          db.get('SELECT * FROM players WHERE team_id = ? AND id != ? ORDER BY id LIMIT 1', [teamId, playerRow.id], (err, newOwnerRow) => {
            if (err) {
              console.error('Error finding new team owner:', err);
              return interaction.reply('An error occurred while leaving the team. Please try again later.');
            }
  
            if (newOwnerRow) {
              db.run('UPDATE teams SET owner_id = ? WHERE id = ?', [newOwnerRow.id, teamId], (err) => {
                if (err) {
                  console.error('Error updating team owner:', err);
                  return interaction.reply('An error occurred while leaving the team. Please try again later.');
                }
  
                interaction.reply(`You have left the team and ownership has been transferred to ${newOwnerRow.name}.`);
  
                db.run('UPDATE players SET team_id = NULL WHERE id = ?', [playerRow.id], (err) => {
                  if (err) {
                    console.error('Error removing player from team:', err);
                  }
                });
              });
            } else {
              // If there are no other team members, delete the team
              db.run('DELETE FROM teams WHERE id = ?', [teamId], (err) => {
                if (err) {
                  console.error('Error deleting team:', err);
                  return interaction.reply('An error occurred while leaving the team. Please try again later.');
                }
  
                interaction.reply(`You have left the team and the team has been disbanded.`);
  
                db.run('UPDATE players SET team_id = NULL WHERE id = ?', [playerRow.id], (err) => {
                  if (err) {
                    console.error('Error removing player from team:', err);
                  }
                });
              });
            }
          });
        } else {
          // If the player is not the team owner, simply remove them from the team
          db.run('UPDATE players SET team_id = NULL WHERE id = ?', [playerRow.id], (err) => {
            if (err) {
              console.error('Error removing player from team:', err);
              return interaction.reply('An error occurred while leaving the team. Please try again later.');
            }
  
            interaction.reply(`You have left the team.`);
          });
        }
      });
    });
  }
  
  async function handleOwnershipTransfer(interaction) {
    if (!isPlayer(interaction)) {
      return interaction.reply('Only players can transfer team ownership.');
    }
    const userId = interaction.user.id;
    const newOwnerId = interaction.options.getUser('player').id;
  
    db.get('SELECT * FROM players WHERE discord_id = ?', [userId], (err, playerRow) => {
      if (err) {
        console.error('Error checking player:', err);
        return interaction.reply('An error occurred while transferring ownership. Please try again later.');
      }
  
      if (!playerRow) {
        return interaction.reply('You are not registered for the game.');
      }
  
      if (!playerRow.team_id) {
        return interaction.reply('You are not a member of any team.');
      }
  
      const teamId = playerRow.team_id;
  
      db.get('SELECT * FROM teams WHERE id = ?', [teamId], (err, teamRow) => {
        if (err) {
          console.error('Error checking team:', err);
          return interaction.reply('An error occurred while transferring ownership. Please try again later.');
        }
  
        if (!teamRow) {
          return interaction.reply('The specified team does not exist.');
        }
  
        if (teamRow.owner_id !== playerRow.id) {
          return interaction.reply('You must be the team owner to transfer ownership.');
        }
  
        db.get('SELECT * FROM players WHERE discord_id = ? AND team_id = ?', [newOwnerId, teamId], (err, newOwnerRow) => {
          if (err) {
            console.error('Error checking new owner:', err);
            return interaction.reply('An error occurred while transferring ownership. Please try again later.');
          }
  
          if (!newOwnerRow) {
            return interaction.reply('The specified player is not a member of your team.');
          }
  
          db.run('UPDATE teams SET owner_id = ? WHERE id = ?', [newOwnerRow.id, teamId], (err) => {
            if (err) {
              console.error('Error updating team owner:', err);
              return interaction.reply('An error occurred while transferring ownership. Please try again later.');
            }
  
            interaction.reply(`Team ownership has been transferred to ${newOwnerRow.name}.`);
          });
        });
      });
    });
  }
  
  async function handlePlayerKick(interaction) {
    if (!isPlayer(interaction)) {
      return interaction.reply('Only players can kick other players from a team.');
    }
    const userId = interaction.user.id;
    const playerId = interaction.options.getUser('player').id;
  
    // Check if the player is trying to kick themselves
    if (userId === playerId) {
      return interaction.reply('You cannot kick yourself from the team.');
    }
  
    db.get('SELECT * FROM players WHERE discord_id = ?', [userId], (err, playerRow) => {
      if (err) {
        console.error('Error checking player:', err);
        return interaction.reply('An error occurred while kicking the player. Please try again later.');
      }
  
      if (!playerRow) {
        return interaction.reply('You are not registered for the game.');
      }
  
      if (!playerRow.team_id) {
        return interaction.reply('You are not a member of any team.');
      }
  
      const teamId = playerRow.team_id;
  
      db.get('SELECT * FROM teams WHERE id = ?', [teamId], (err, teamRow) => {
        if (err) {
          console.error('Error checking team:', err);
          return interaction.reply('An error occurred while kicking the player. Please try again later.');
        }
  
        if (!teamRow) {
          return interaction.reply('The specified team does not exist.');
        }
  
        if (teamRow.owner_id !== playerRow.id) {
          return interaction.reply('You must be the team owner to kick players.');
        }
  
        db.get('SELECT * FROM players WHERE discord_id = ? AND team_id = ?', [playerId, teamId], (err, kickedPlayerRow) => {
          if (err) {
            console.error('Error checking kicked player:', err);
            return interaction.reply('An error occurred while kicking the player. Please try again later.');
          }
  
          if (!kickedPlayerRow) {
            return interaction.reply('The specified player is not a member of your team.');
          }
  
          db.run('UPDATE players SET team_id = NULL WHERE id = ?', [kickedPlayerRow.id], (err) => {
            if (err) {
              console.error('Error kicking player:', err);
              return interaction.reply('An error occurred while kicking the player. Please try again later.');
            }
  
            interaction.reply(`${kickedPlayerRow.name} has been kicked from the team.`);
          });
        });
      });
    });
  }

async function isGameManager(interaction) {
  const gameManagerRoleId = config.roles.game_manager;
  const member = await interaction.guild.members.fetch(interaction.user.id);
  return member.roles.cache.has(gameManagerRoleId);
}

async function handleGameStart(interaction) {
  const userId = interaction.user.id;
  const isAdmin = await isGameManager(interaction);

  if (!isAdmin) {
    return interaction.reply('You must be an admin to start the game.');
  }

  db.get('SELECT state FROM game_state', (err, row) => {
    if (err) {
      console.error('Error checking game state:', err);
      return interaction.reply('An error occurred while starting the game. Please try again later.');
    }

    if (row.state === config.game.states.active) {
      return interaction.reply('The game has already started and cannot be started again.');
    }

    db.run('UPDATE game_state SET state = ?', [config.game.states.active], (err) => {
      if (err) {
        console.error('Error updating game state:', err);
        return interaction.reply('An error occurred while starting the game. Please try again later.');
      }

      assignTargets();
      startGameLoop();

      interaction.reply('The game has been started!');
    });
  });
}

async function handleAssassinationReport(interaction) {

  if (!isPlayer(interaction)) {
    return interaction.reply('Only players can report assassinations.');
  }

  db.get('SELECT state FROM game_state', (err, row) => {
    if (err) {
      console.error('Error checking game state:', err);
      return interaction.reply('An error occurred while reporting the assassination. Please try again later.');
    }

    if (row.state !== config.game.states.active) {
      return interaction.reply('Assassination reports can only be submitted during an active game.');
    }
  const votingChannel = interaction.guild.channels.cache.get(config.channels.voting);
  const assassinId = interaction.user.id;
  const target = interaction.options.getUser('target');
  const evidenceImage = interaction.options.getAttachment('evidence');

  if (!target) {
    return interaction.reply('Please provide a valid player to assassinate.');
  }

  const targetId = target.id;

  db.get('SELECT * FROM players WHERE discord_id = ?', [assassinId], (err, assassinRow) => {
    if (err) {
      console.error('Error checking assassin:', err);
      return interaction.reply('An error occurred while reporting the assassination. Please try again later.');
    }

    if (!assassinRow || !assassinRow.is_alive) {
      return interaction.reply('You must be an alive player to report an assassination.');
    }

    db.get('SELECT * FROM players WHERE discord_id = ?', [targetId], (err, targetRow) => {
      if (err) {
        console.error('Error checking target:', err);
        return interaction.reply('An error occurred while reporting the assassination. Please try again later.');
      }

      if (!targetRow || !targetRow.is_alive) {
        return interaction.reply('The specified target is not an alive player.');
      }

      db.run('INSERT INTO assassinations (assassin_id, target_id, evidence_url) VALUES (?, ?, ?)', [assassinId, targetId, evidenceImage.url], async function(err) {
        if (err) {
          console.error('Error inserting assassination:', err);
          return interaction.reply('An error occurred while processing the assassination. Please try again later.');
        }

        const assassinationId = this.lastID;
        const embed = new EmbedBuilder()
          .setTitle('Assassination Evidence')
          .setDescription(`Assassin: ${interaction.user.username}\nTarget: ${target.username}`)
          .setImage(evidenceImage.url)
          .setFooter({ text: `Assassination ID: ${assassinationId}` });

        const votingTimeLimit = config.game.voting_time_limit * 60 * 60 * 1000; // Convert hours to milliseconds

        const votingMessage = await votingChannel.send({
          content: 'Assassination reported. Please vote within the time limit.',
          embeds: [embed],
        });

        await votingMessage.react('✅');
        await votingMessage.react('❌');

        const filter = (reaction, user) => ['✅', '❌'].includes(reaction.emoji.name) && !user.bot;
        const collector = votingMessage.createReactionCollector({ filter, time: votingTimeLimit });

        collector.on('end', (collected) => {
          const upvotes = collected.get('✅')?.count || 0;
          const downvotes = collected.get('❌')?.count || 0;

          if (upvotes > downvotes) {
            interaction.followUp('Assassination approved by majority vote.');
            handleAssassinationApproval(interaction, assassinationId, assassinId, targetId);
          } else {
            interaction.followUp('Assassination rejected by majority vote.');
            handleAssassinationRejection(interaction, assassinationId);
          }
        });

        interaction.reply('Your assassination report has been submitted for voting.');
      });
    });
  });
});
}

async function handleDisputeSubmission(interaction) {
  if (!isPlayer(interaction)) {
    return interaction.reply('Only players can submit disputes.');
  }
    const channel = interaction.guild.channels.cache.get(config.channels.disputes);
    const userId = interaction.user.id;
    const dispute = interaction.options.getString('dispute');
  
    db.get('SELECT * FROM players WHERE discord_id = ?', [userId], (err, playerRow) => {
      if (err) {
        console.error('Error checking player:', err);
        return interaction.reply('An error occurred while submitting the dispute. Please try again later.');
      }
  
      if (!playerRow) {
        return interaction.reply('You must be a registered player to submit a dispute.');
      }
  
      db.run('INSERT INTO disputes (submitter_id, dispute_text) VALUES (?, ?)', [userId, dispute], function(err) {
        if (err) {
          console.error('Error inserting dispute:', err);
          return interaction.reply('An error occurred while submitting the dispute. Please try again later.');
        }
  
        const disputeId = this.lastID;
        const embed = new EmbedBuilder()
          .setTitle('Dispute Submission')
          .setDescription(`Submitted by: ${interaction.user.username}\n\n${dispute}`)
          .setFooter({ text: `Dispute ID: ${disputeId}` });
  
        channel.send({ embeds: [embed] });
        interaction.reply('Your dispute has been submitted for review.');
      });
    });
  }

async function handleDisputeResolution(interaction) {
    const isAdmin = await isGameManager(interaction);
  
    if (!isAdmin) {
      return interaction.reply('You must be a game manager to resolve disputes.');
    }
  
    const disputeId = interaction.options.getString('dispute_id');
    const resolution = interaction.options.getString('resolution');
  
    db.get('SELECT * FROM disputes WHERE id = ?', [disputeId], (err, row) => {
      if (err) {
        console.error('Error fetching dispute:', err);
        return interaction.reply('An error occurred while resolving the dispute. Please try again later.');
      }
  
      if (!row) {
        return interaction.reply('The specified dispute does not exist.');
      }
  
      const channel = interaction.guild.channels.cache.get(config.channels.disputes);
      const embed = new EmbedBuilder()
        .setTitle('Dispute Resolution')
        .setDescription(`Dispute ID: ${disputeId}\nResolved by: ${interaction.user.username}\n\n${resolution}`);
  
      channel.send({ embeds: [embed] });
      interaction.reply('The dispute has been resolved.');
    });
  }

async function displayLeaderboard(interaction) {
  const channel = interaction.guild.channels.cache.get(config.channels.leaderboard);

  db.all('SELECT t.name AS team_name, COUNT(k.id) AS kills FROM teams t LEFT JOIN players p ON t.id = p.team_id LEFT JOIN kills k ON p.id = k.assassin_id GROUP BY t.id ORDER BY kills DESC', (err, rows) => {
    if (err) {
      console.error('Error fetching leaderboard data:', err);
      return interaction.reply('An error occurred while displaying the leaderboard. Please try again later.');
    }

    let leaderboard = 'Leaderboard:\n\n';
    rows.forEach((row, index) => {
      leaderboard += `${index + 1}. ${row.team_name} - ${row.kills} kills\n`;
    });

    const embed = new EmbedBuilder()
      .setTitle('Assassin Game Leaderboard')
      .setDescription(leaderboard);

    channel.send({ embeds: [embed] });
    interaction.reply('The leaderboard has been updated.');
  });
}

async function displayRules(interaction) {
  const rulesFile = fs.readFileSync(config.rules_file, 'utf8');
  const embed = new EmbedBuilder()
    .setTitle('Assassin Game Rules')
    .setDescription(rulesFile);

  interaction.reply({ embeds: [embed] });
}

async function displayPlayerList(interaction) {
  db.all('SELECT p.id, p.name, t.name AS team_name, p.is_alive FROM players p LEFT JOIN teams t ON p.team_id = t.id', (err, rows) => {
    if (err) {
      console.error('Error fetching player list:', err);
      return interaction.reply('An error occurred while displaying the player list. Please try again later.');
    }

    let playerList = 'Player List:\n\n';
    rows.forEach((row) => {
      playerList += `ID: ${row.id} | ${row.name} - Team: ${row.team_name || 'None'}, Status: ${row.is_alive ? 'Alive' : 'Eliminated'}\n`;
    });

    const embed = new EmbedBuilder()
      .setTitle('Assassin Game Player List')
      .setDescription(playerList);

    interaction.reply({ embeds: [embed] });
  });
}

async function displayTeamList(interaction) {
  db.all(`
    SELECT 
      t.id, 
      t.name, 
      p.name AS owner_name, 
      GROUP_CONCAT(p2.name) AS member_names,
      COUNT(p2.id) AS member_count,
      CASE 
        WHEN COUNT(p2.id) = COUNT(CASE WHEN p2.is_alive = 1 THEN 1 END) THEN 'Alive'
        ELSE 'Eliminated'
      END AS status
    FROM teams t
    LEFT JOIN players p ON t.owner_id = p.id
    LEFT JOIN players p2 ON t.id = p2.team_id
    GROUP BY t.id
  `, (err, rows) => {
    if (err) {
      console.error('Error fetching team list:', err);
      return interaction.reply('An error occurred while displaying the team list. Please try again later.');
    }

    let teamList = 'Team List:\n\n';
    rows.forEach((row) => {
      teamList += `ID: ${row.id} | ${row.name}\n`;
      teamList += `Owner: ${row.owner_name}\n`;
      teamList += `Members: ${row.member_names || 'None'}\n`;
      teamList += `Member Count: ${row.member_count}\n`;
      teamList += `Status: ${row.status}\n\n`;
    });

    const embed = new EmbedBuilder()
      .setTitle('Assassin Game Team List')
      .setDescription(teamList);

    interaction.reply({ embeds: [embed] });
  });
}

async function displayHelp(interaction) {
    const helpMessage = `
      Assassin Game Bot Commands:
      
      /join - Register for the game
      /create-team <name> - Create a new team
      /join-team <team> - Request to join a team
      /leave-team - Leave your current team
      /transfer-ownership <player> - Transfer team ownership to another player
      /kick-player <player> - Kick a player from your team (team owner only)
      /start-game - Start the game (admin only)
      /report-assassination <target> <evidence> - Report an assassination with evidence
      /submit-dispute <dispute> - Submit a dispute for review
      /resolve-dispute <dispute_id> <resolution> - Resolve a dispute (admin only)
      /leaderboard - Display the current leaderboard
      /rules - Display the game rules
      /player-list - Display the list of players and their status
      /team-list - Display the list of teams and their information
      /help - Display this help message
      /eliminate - Eliminate a player from the game (admin only)
      /revive - Revive a player in the game (admin only)
    `;
  
    const embed = new EmbedBuilder()
      .setTitle('Assassin Game Help')
      .setDescription(helpMessage);
  
    interaction.reply({ embeds: [embed] });
  }

  async function eliminatePlayer(interaction) {
    const isAdmin = await isGameManager(interaction);
  
    if (!isAdmin) {
      return interaction.reply('You must be a game manager to eliminate players.');
    }
  
    const playerId = interaction.options.getString('player_id');
  
    db.get('SELECT * FROM players WHERE id = ?', [playerId], (err, row) => {
      if (err) {
        console.error('Error fetching player:', err);
        return interaction.reply('An error occurred while eliminating the player. Please try again later.');
      }
  
      if (!row) {
        return interaction.reply('The specified player does not exist.');
      }
  
      db.run('UPDATE players SET is_alive = 0 WHERE id = ?', [playerId], (err) => {
        if (err) {
          console.error('Error eliminating player:', err);
          return interaction.reply('An error occurred while eliminating the player. Please try again later.');
        }
  
        interaction.reply(`Player with ID ${playerId} has been eliminated from the game.`);
        const statusChannel = client.channels.cache.get(config.channels.status);
        statusChannel.send(`Player ${targetRow.name} from team ${targetTeam.name} has been eliminated!`);
        updateLeaderboard();
        updateGameState();
      });
    });
  }

  async function revivePlayer(interaction) {
    const isAdmin = await isGameManager(interaction);
  
    if (!isAdmin) {
      return interaction.reply('You must be a game manager to revive players.');
    }
  
    const playerId = interaction.options.getString('player_id');
  
    db.get('SELECT * FROM players WHERE id = ?', [playerId], (err, row) => {
      if (err) {
        console.error('Error fetching player:', err);
        return interaction.reply('An error occurred while reviving the player. Please try again later.');
      }
  
      if (!row) {
        return interaction.reply('The specified player does not exist.');
      }
  
      db.run('UPDATE players SET is_alive = 1 WHERE id = ?', [playerId], (err) => {
        if (err) {
          console.error('Error reviving player:', err);
          return interaction.reply('An error occurred while reviving the player. Please try again later.');
        }
  
        interaction.reply(`Player with ID ${playerId} has been revived in the game.`);
        updateLeaderboard();
        updateGameState();
      });
    });
  }

  function checkTeamElimination(targetTeamId) {
    db.get('SELECT * FROM teams WHERE id = ?', [targetTeamId], (err, targetTeam) => {
      if (err) {
        console.error('Error fetching target team:', err);
        return;
      }
  
      if (!targetTeam) {
        console.error('Target team not found.');
        return;
      }
  
      db.all('SELECT * FROM players WHERE team_id = ? AND is_alive = 1', [targetTeamId], (err, alivePlayers) => {
        if (err) {
          console.error('Error fetching alive players:', err);
          return;
        }
  
        if (alivePlayers.length === 0) {
          console.log(`Team ${targetTeam.name} has been eliminated!`);
          const statusChannel = client.channels.cache.get(config.channels.status);
          statusChannel.send(`Team ${targetTeam.name} has been eliminated!`);
  
          // Find the team that was hunting the eliminated team
          db.get('SELECT * FROM teams WHERE target_id = ?', [targetTeamId], (err, huntingTeam) => {
            if (err) {
              console.error('Error fetching hunting team:', err);
              return;
            }
  
            if (huntingTeam) {
              // Assign a new target to the hunting team
              reassignTarget(huntingTeam.id);
            }
          });
        }
      });
    });
  }

  function reassignTarget(teamId) {
    db.all('SELECT * FROM teams WHERE id != ? AND id NOT IN (SELECT target_id FROM teams WHERE target_id IS NOT NULL)', [teamId], (err, availableTargets) => {
      if (err) {
        console.error('Error fetching available targets:', err);
        return;
      }
  
      if (availableTargets.length === 0) {
        console.log(`No available targets for team ${teamId}`);
        return;
      }
  
      const newTargetId = availableTargets[Math.floor(Math.random() * availableTargets.length)].id;
  
      db.run('UPDATE teams SET target_id = ? WHERE id = ?', [newTargetId, teamId], (err) => {
        if (err) {
          console.error('Error updating team target:', err);
          return;
        }
  
        console.log(`Assigned new target ${newTargetId} to team ${teamId}`);
  
        // Send DMs to the team members with their new assigned target
        db.all('SELECT * FROM players WHERE team_id = ?', [teamId], (err, players) => {
          if (!err && players) {
            players.forEach((player) => {
              client.users.fetch(player.discord_id)
                .then((user) => {
                  db.get('SELECT * FROM teams WHERE id = ?', [newTargetId], (err, newTargetTeam) => {
                    if (!err && newTargetTeam) {
                      user.send(`Your team's new target is: ${newTargetTeam.name}`);
                    }
                  });
                })
                .catch((err) => {
                  console.error('Error sending new target DM to player:', err);
                });
            });
          }
        });
      });
    });
  }

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;

  if (message.channel.id === config.channels.voting) {
    if (message.attachments.size === 0) {
      await message.delete();
      return;
    }

    const attachment = message.attachments.first();
    const assassination = {
      assassin_id: message.author.id,
      target_id: null,
      evidence_url: attachment.url,
    };

    db.run('INSERT INTO assassinations (assassin_id, evidence_url) VALUES (?, ?)', [assassination.assassin_id, assassination.evidence_url], (err) => {
      if (err) {
        console.error('Error inserting assassination:', err);
        return message.reply('An error occurred while processing the assassination. Please try again later.');
      }

      const embed = new EmbedBuilder()
        .setTitle('Assassination Evidence')
        .setDescription(`Submitted by: ${message.author.username}`)
        .setImage(attachment.url)
        .setFooter('Please vote on whether to approve or reject the assassination.');

      const approveButton = {
        type: 2,
        style: 3,
        label: 'Approve',
        custom_id: `assassinationapprove_${message.id}`,
      };

      const rejectButton = {
        type: 2,
        style: 4,
        label: 'Reject',
        custom_id: `assassinationreject_${message.id}`,
      };

      const actionRow = {
        type: 1,
        components: [approveButton, rejectButton],
      };

      message.reply({ embeds: [embed], components: [actionRow] });
    });
  }
});

async function handleJoinButtonInteraction(interaction, action, playerId, teamId) {
    if (action === 'joinapprove') {
      db.run('UPDATE players SET team_id = ? WHERE id = ?', [teamId, playerId], (err) => {
        if (err) {
          console.error('Error updating player team:', err);
          return interaction.reply('An error occurred while approving the join request. Please try again later.');
        }
  
        interaction.reply(`Player has been added to your team!`);
  
        client.users.fetch(playerId)
          .then((player) => {
            player.send(`Your request to join the team has been approved!`);
          })
          .catch((err) => {
            console.error('Error sending approval message to player:', err);
          });
      });
    } else if (action === 'joinreject') {
      interaction.reply(`Join request has been rejected.`);
      client.users.fetch(playerId)
        .then((player) => {
          player.send(`Your request to join the team has been rejected.`);
        })
        .catch((err) => {
          console.error('Error sending rejection message to player:', err);
        });
    }
  }
  
  async function handleAssassinationButtonInteraction(interaction, assassinationId) {
    if (!isPlayer(interaction)) {
      return interaction.reply('Only players can interact with assassination reports.');
    }
    const [action] = interaction.customId.split('_');
  
    if (action === 'assassinationapprove') {
      db.get('SELECT assassin_id, target_id FROM assassinations WHERE id = ?', [assassinationId], async (err, row) => {
        if (err) {
          console.error('Error fetching assassination data:', err);
          return interaction.reply('An error occurred while processing the assassination. Please try again later.');
        }
  
        if (!row) {
          return interaction.reply('The specified assassination does not exist.');
        }
  
        const assassinId = row.assassin_id;
        const targetId = row.target_id;
  
        try {
          await handleAssassinationApproval(interaction, assassinationId, assassinId, targetId);
        } catch (error) {
          console.error('Error handling assassination approval:', error);
          interaction.reply('An error occurred while processing the assassination. Please try again later.');
        }
      });
    } else if (action === 'assassinationreject') {
      handleAssassinationRejection(interaction, assassinationId);
    }
  }

  async function handleAssassinationApproval(interaction, assassinationId, assassinId, targetId) {
    db.serialize(() => {
      db.run('UPDATE players SET is_alive = 0 WHERE discord_id = ?', [targetId], (err) => {
        if (err) {
          console.error('Error updating player status:', err);
          interaction.reply('An error occurred while processing the assassination. Please try again later.');
          return;
        }
  
        db.run('INSERT INTO kills (assassin_id, target_id) VALUES (?, ?)', [assassinId, targetId], (err) => {
          if (err) {
            console.error('Error inserting kill:', err);
            interaction.reply('An error occurred while processing the assassination. Please try again later.');
            return;
          }
  
          interaction.update({ content: `The assassination (ID: ${assassinationId}) has been approved.`, components: [] });
          updateLeaderboard();
          updateGameState();
  
          // Check if the target team has been eliminated
          db.get('SELECT * FROM players WHERE discord_id = ?', [targetId], (err, targetRow) => {
            if (err) {
              console.error('Error fetching target player:', err);
            } else {
              checkTeamElimination(targetRow.team_id);
  
              // Fetch target player and team details
              db.get('SELECT p.name, t.name AS team_name FROM players p JOIN teams t ON p.team_id = t.id WHERE p.id = ?', [targetRow.id], (err, playerTeamRow) => {
                if (err) {
                  console.error('Error fetching player and team details:', err);
                } else {
                  const statusChannel = client.channels.cache.get(config.channels.status);
                  statusChannel.send(`Player ${playerTeamRow.name} from team ${playerTeamRow.team_name} has been eliminated!`);
                }
              });
            }
          });
  
          // Send approval message to the assassin
          client.users.fetch(assassinId)
            .then((assassin) => {
              assassin.send(`Your assassination (ID: ${assassinationId}) has been approved!`);
            })
            .catch((err) => {
              console.error('Error sending approval message to assassin:', err);
            });
        });
      });
    });
  }
  
  async function handleAssassinationRejection(interaction, assassinationId) {
    interaction.update({ content: `The assassination (ID: ${assassinationId}) has been rejected.`, components: [] });
    // Send rejection message to the assassin
    db.get('SELECT assassin_id FROM assassinations WHERE id = ?', [assassinationId], (err, row) => {
      if (!err && row) {
        const assassinId = row.assassin_id;
        client.users.fetch(assassinId)
          .then((assassin) => {
            assassin.send(`Your assassination (ID: ${assassinationId}) has been rejected.`);
          })
          .catch((err) => {
            console.error('Error sending rejection message to assassin:', err);
          });
      }
    });
  }

  client.on('interactionCreate', async (interaction) => {
    if (!interaction.isButton()) return;
  
    const [action, ...args] = interaction.customId.split('_');
  
    if (action === 'joinapprove' || action === 'joinreject') {
      const [playerId, teamId] = args;
      await handleJoinButtonInteraction(interaction, action, playerId, teamId);
    } else if (action === 'assassinationapprove' || action === 'assassinationreject') {
      const [assassinationId] = args;
      await handleAssassinationButtonInteraction(interaction, assassinationId);
    }
    else if (action === 'approvePlayer') {
        const [playerId] = args;
        await approvePlayer(interaction, playerId);
    } else if (action === 'rejectPlayer') {
        const [playerId] = args;
        await rejectPlayer(interaction, playerId);
    }
  });

  function endGame() {
    db.run('UPDATE game_state SET state = ?', ['ended'], (err) => {
      if (err) {
        console.error('Error updating game state:', err);
        return;
      }
  
      const channel = client.channels.cache.get(config.channels.status);
      channel.send('The game has ended.');
    });
  }
  
  function determineWinner() {
    return new Promise((resolve, reject) => {
      db.all('SELECT t.id, t.name AS team_name, COUNT(k.id) AS kills FROM teams t LEFT JOIN players p ON t.id = p.team_id LEFT JOIN kills k ON p.id = k.assassin_id GROUP BY t.id ORDER BY kills DESC', (err, rows) => {
        if (err) {
          console.error('Error fetching team standings:', err);
          reject(err);
        } else {
          if (rows.length === 1) {
            resolve(rows[0]);
          } else if (rows.length > 1) {
            const tiedTeams = rows.filter((row) => row.kills === rows[0].kills);
            if (tiedTeams.length > 1) {
              resolve(null);
            } else {
              resolve(tiedTeams[0]);
            }
          } else {
            resolve(null);
          }
        }
      });
    });
  }
  
  function handleSuddenDeath() {
    return new Promise((resolve, reject) => {
      db.all('SELECT t.id, t.name AS team_name, COUNT(p.id) AS alive_players FROM teams t LEFT JOIN players p ON t.id = p.team_id AND p.is_alive = 1 GROUP BY t.id', (err, rows) => {
        if (err) {
          console.error('Error fetching team standings:', err);
          reject(err);
        } else {
          const aliveTeams = rows.filter((row) => row.alive_players > 0);
          if (aliveTeams.length === 1) {
            resolve(aliveTeams[0]);
          } else {
            const suddenDeathTeams = aliveTeams.map((team) => team.id);
            const shuffledTeams = shuffle(suddenDeathTeams);
  
            const updateQueries = [];
            for (let i = 0; i < shuffledTeams.length; i += 2) {
              const team1 = shuffledTeams[i];
              const team2 = shuffledTeams[i + 1];
  
              if (team2) {
                updateQueries.push(
                  new Promise((resolve, reject) => {
                    db.run('UPDATE teams SET target_id = ? WHERE id = ?', [team2, team1], (err) => {
                      if (err) {
                        reject(err);
                      } else {
                        resolve();
                      }
                    });
                  })
                );
                updateQueries.push(
                  new Promise((resolve, reject) => {
                    db.run('UPDATE teams SET target_id = ? WHERE id = ?', [team1, team2], (err) => {
                      if (err) {
                        reject(err);
                      } else {
                        resolve();
                      }
                    });
                  })
                );
              }
            }
  
            Promise.all(updateQueries)
              .then(() => {
                const channel = client.channels.cache.get(config.channels.status);
                channel.send('Sudden death targets have been assigned. The first team to eliminate their target wins!');
                resolve(null);
              })
              .catch((error) => {
                console.error('Error updating sudden death targets:', error);
                reject(error);
              });
          }
        }
      });
    });
  }
  
  async function updateGameState() {
    try {
      const now = new Date();
      const endDate = new Date(config.game.end_date);
  
      if (now >= endDate) {
        endGame();
      } else {
        const winner = await determineWinner();
        if (winner) {
          const channel = client.channels.cache.get(config.channels.status);
          channel.send(`The game has ended! The winning team is ${winner.team_name} with ${winner.kills} kills.`);
          endGame();
        } else {
          const suddenDeathWinner = await handleSuddenDeath();
          if (suddenDeathWinner) {
            const channel = client.channels.cache.get(config.channels.status);
            channel.send(`The game has ended! The winning team is ${suddenDeathWinner.team_name}.`);
            endGame();
          }
        }
      }
    } catch (error) {
      console.error('Error updating game state:', error);
    }
  }

  function assignTargets() {
    db.all('SELECT * FROM teams', (err, teams) => {
      if (err) {
        console.error('Error fetching teams:', err);
        return;
      }
  
      const teamIds = teams.map((team) => team.id);
      const shuffledTeamIds = shuffle(teamIds);
  
      const targetAssignments = {};
      for (let i = 0; i < shuffledTeamIds.length; i++) {
        const teamId = shuffledTeamIds[i];
        const targetId = shuffledTeamIds[(i + 1) % shuffledTeamIds.length];
        targetAssignments[teamId] = targetId;
      }
  
      const updateQueries = Object.entries(targetAssignments).map(([teamId, targetId]) => {
        return new Promise((resolve, reject) => {
          db.run('UPDATE teams SET target_id = ? WHERE id = ?', [targetId, teamId], (err) => {
            if (err) {
              reject(err);
            } else {
              resolve();
            }
          });
        });
      });
  
      Promise.all(updateQueries)
        .then(() => {
          console.log('Targets assigned successfully');
          // Send DMs to players with their assigned targets
          db.all('SELECT * FROM players WHERE team_id = ?', [teamId], (err, players) => {
            if (!err && players) {
              players.forEach((player) => {
                client.users.fetch(player.discord_id)
                  .then((user) => {
                    db.get('SELECT * FROM teams WHERE id = ?', [targetId], (err, targetTeam) => {
                      if (!err && targetTeam) {
                        user.send(`Your team's target is: ${targetTeam.name}`);
                      }
                    });
                  })
                  .catch((err) => {
                    console.error('Error sending target DM to player:', err);
                  });
                });
              }
            });
        })
        .catch((error) => {
          console.error('Error updating team targets:', error);
        });
    });
  }

function updateLeaderboard() {
  const channel = client.channels.cache.get(config.channels.leaderboard);

  db.all('SELECT t.name AS team_name, COUNT(k.id) AS kills FROM teams t LEFT JOIN players p ON t.id = p.team_id LEFT JOIN kills k ON p.id = k.assassin_id GROUP BY t.id ORDER BY kills DESC', (err, rows) => {
    if (err) {
      console.error('Error fetching leaderboard data:', err);
      return;
    }

    let leaderboard = 'Leaderboard:\n\n';
    rows.forEach((row, index) => {
      leaderboard += `${index + 1}. ${row.team_name} - ${row.kills} kills\n`;
    });

    const embed = new EmbedBuilder()
      .setTitle('Assassin Game Leaderboard')
      .setDescription(leaderboard);

    channel.messages.fetch({ limit: 1 })
      .then((messages) => {
        const lastMessage = messages.first();

        if (lastMessage && lastMessage.author.id === client.user.id) {
          lastMessage.edit({ embeds: [embed] });
        } else {
          channel.send({ embeds: [embed] });
        }
      })
      .catch((err) => {
        console.error('Error fetching leaderboard message:', err);
      });
  });
}

function isPlayer(interaction) {
  return interaction.member.roles.cache.has(config.roles.player);
}

client.login(config.bot.token);