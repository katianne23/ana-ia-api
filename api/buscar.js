const { google } = require("googleapis");

// ==========================================
// CONFIGURAÇÃO DAS PLANILHAS
// ==========================================

const PLANILHA_SP_ID = "1p_fGcdYYxBZaud8sBS78WuagB057OB1Xv34Lkc94V7E";
const ABA_SP_GID = 116363705;

const PLANILHA_RJ_ID = "1xCxEIRZN1kP-BEUhSJAByArvjEYMk1R4NTAdxuNElmc";
const ABA_RJ_GID = 2116486440;

const PLANILHA_DEMAIS_ID = "1-8h0tJTFIymP6NPCfAIGDs40YkJ_DSHoCe6xJE03xXA";
const ABA_DEMAIS_GID = 506062902;

const PLANILHA_CONTATOS_ID = "1Mp_G0e8ZlN-ofQZX0w-wZSUuQgTtuzCHlk7i6HfsiJ4";
const ABA_CONTATOS_GID = 1846076689;

const IPI_PADRAO = "5,2%";

// ==========================================
// CONEXÃO GOOGLE
// ==========================================

async function conectarGoogle() {
  if (!process.env.GOOGLE_SERVICE_ACCOUNT_KEY) {
    throw new Error("Credencial Google não configurada.");
  }

  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_KEY);

  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });

  return google.sheets({
    version: "v4",
    auth,
  });
}

// ==========================================
// NORMALIZAÇÃO
// ==========================================

function normalizarTexto(texto) {
  return String(texto || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[×]/g, " X ")
    .replace(/[^\w\s]/g, " ")
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// ==========================================
// NORMALIZAÇÃO DO ID DO CATÁLOGO
// ==========================================

function normalizarIdCatalogo(id) {
  return String(id || "")
    .trim()
    .replace(/\s*:\s*/g, ":");
}

// ==========================================
// OBTER PARÂMETROS DA REQUISIÇÃO
// ==========================================

function obterParametro(req, nome) {
  const valorBruto = req.query?.[nome];

  const valores = Array.isArray(valorBruto) ? valorBruto : [valorBruto];

  const valoresValidos = valores
    .flatMap((item) => {
      const texto = String(item || "").trim();

      // O ID não possui vírgulas.
      // Se vier concatenado, separa os valores.
      if (nome === "id_catalogo") {
        return texto.split(",");
      }

      return [texto];
    })
    .map((item) => item.trim())
    .filter((item) => item && !item.includes("{{") && !item.includes("<AI_"));

  return valoresValidos[valoresValidos.length - 1] || "";
}

// Preserva números decimais para leitura técnica.
function normalizarCaracteristicas(texto) {
  return String(texto || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/(\d),(\d)/g, "$1.$2")
    .replace(/[×]/g, " X ")
    .replace(/[^\w.\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// ==========================================
// SINÔNIMOS
// ==========================================

const SINONIMOS = {
  BACKAUS: "BACKHAUS",
  BACKAUSS: "BACKHAUS",
  BACKHAUSS: "BACKHAUS",

  INOXIDAVEL: "INOX",
  INOXIDAVEIS: "INOX",
  ACOINOX: "INOX",

  METZEMBAUM: "METZENBAUM",

  HISTOMETRO: "HISTEROMETRO",

  YANKAUR: "YANKAUER",

  STEINMAN: "STEIMAN",
};

const PALAVRAS_IGNORADAS = new Set([
  "QUERO",
  "COTAR",
  "COTACAO",
  "PRECISO",
  "DE",
  "DO",
  "DA",
  "DOS",
  "DAS",
  "O",
  "A",
  "OS",
  "AS",
  "UM",
  "UMA",
  "COM",
  "PARA",
  "POR",
  "EM",
  "NO",
  "NA",
  "NOS",
  "NAS",
  "E",
  "OU",
  "ME",
  "ENVIE",
  "INFORME",
  "PRODUTO",
  "ITEM",
  "ITENS",
  "REFERENCIA",
  "REF",
  "CODIGO",
  "UN",
  "UND",
  "UNIDADE",
  "UNIDADES",
  "QUANTIDADE",
  "QTD",
  "MATERIAL",
  "CONFECCIONADO",
  "CONFECCIONADA",
  "FABRICADO",
  "FABRICADA",
  "CAPACIDADE",
  "FORMATO",
  "TIPO",
  "APROXIMADAMENTE",
  "APROX",
]);

function normalizarToken(token) {
  return SINONIMOS[token] || token;
}

function obterTokens(texto) {
  return normalizarTexto(texto)
    .split(" ")
    .map(normalizarToken)
    .filter((token) => {
      if (!token || PALAVRAS_IGNORADAS.has(token)) {
        return false;
      }

      if (/^\d+$/.test(token)) {
        return false;
      }

      // Retira unidades e dimensões da comparação textual.
      if (/^\d+(?:\.\d+)?(?:MM|CM|ML|M|L)$/.test(token)) {
        return false;
      }

      return token !== "X";
    });
}

// ==========================================
// DISTÂNCIA DE LEVENSHTEIN
// ==========================================

function distanciaLevenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  const matriz = [];

  for (let i = 0; i <= b.length; i++) {
    matriz[i] = [i];
  }

  for (let j = 0; j <= a.length; j++) {
    matriz[0][j] = j;
  }

  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      const custo = a[j - 1] === b[i - 1] ? 0 : 1;

      matriz[i][j] = Math.min(
        matriz[i - 1][j] + 1,
        matriz[i][j - 1] + 1,
        matriz[i - 1][j - 1] + custo,
      );
    }
  }

  return matriz[b.length][a.length];
}

function tokensParecidos(tokenA, tokenB) {
  if (tokenA === tokenB) return true;

  if (tokenA.length < 5 || tokenB.length < 5) {
    return false;
  }

  const distancia = distanciaLevenshtein(tokenA, tokenB);

  if (Math.min(tokenA.length, tokenB.length) >= 9) {
    return distancia <= 2;
  }

  return distancia <= 1;
}

// ==========================================
// EXTRAÇÃO DE CARACTERÍSTICAS TÉCNICAS
// ==========================================

function converterParaMM(valor, unidade) {
  const numero = Number(valor);

  if (!Number.isFinite(numero)) return null;

  if (unidade === "M") return numero * 1000;
  if (unidade === "CM") return numero * 10;

  return numero;
}

function extrairCaracteristicas(texto) {
  const original = normalizarCaracteristicas(texto);

  const dimensoes = [];
  const medidasSimples = [];
  const capacidades = [];

  // Dimensões: 40X28CM, 40 X 28 CM.
  const regexDimensoes = /(\d+(?:\.\d+)?)\s*X\s*(\d+(?:\.\d+)?)\s*(MM|CM|M)\b/g;

  let resultado;

  while ((resultado = regexDimensoes.exec(original)) !== null) {
    const unidade = resultado[3];

    const fator = unidade === "M" ? 1000 : unidade === "CM" ? 10 : 1;

    const a = Number(resultado[1]) * fator;
    const b = Number(resultado[2]) * fator;

    dimensoes.push(
      [Number(a.toFixed(4)), Number(b.toFixed(4))].sort((x, y) => x - y),
    );
  }

  const semDimensoes = original.replace(regexDimensoes, " ");

  // Medidas individuais: 13CM, 15CM, 4MM.
  const regexMedidas = /\b(\d+(?:\.\d+)?)\s*(MM|CM|M)\b/g;

  while ((resultado = regexMedidas.exec(semDimensoes)) !== null) {
    const valor = converterParaMM(resultado[1], resultado[2]);

    if (valor !== null) {
      medidasSimples.push(Number(valor.toFixed(4)));
    }
  }

  // Capacidade: 2000ML, 3500ML, 2L.
  const regexCapacidade = /\b(\d+(?:\.\d+)?)\s*(ML|LITROS?|L)\b/g;

  while ((resultado = regexCapacidade.exec(original)) !== null) {
    let valor = Number(resultado[1]);

    if (resultado[2] !== "ML") {
      valor *= 1000;
    }

    capacidades.push(Number(valor.toFixed(4)));
  }

  return {
    dimensoes,
    medidasSimples: [...new Set(medidasSimples)],
    capacidades: [...new Set(capacidades)],
  };
}

// ==========================================
// COMPARAÇÃO DE CARACTERÍSTICAS
// ==========================================

function avaliarCaracteristicas(busca, candidato) {
  const solicitadas = extrairCaracteristicas(busca);
  const cadastradas = extrairCaracteristicas(candidato);

  const resultado = {
    medidasCompativeis: null,
    dimensoesCompativeis: null,
    capacidadesCompativeis: null,
  };

  if (solicitadas.medidasSimples.length) {
    resultado.medidasCompativeis = cadastradas.medidasSimples.length
      ? solicitadas.medidasSimples.every((medida) =>
          cadastradas.medidasSimples.includes(medida),
        )
      : null;
  }

  if (solicitadas.dimensoes.length) {
    resultado.dimensoesCompativeis = cadastradas.dimensoes.length
      ? solicitadas.dimensoes.every((dimensao) =>
          cadastradas.dimensoes.some(
            (cadastrada) =>
              dimensao[0] === cadastrada[0] && dimensao[1] === cadastrada[1],
          ),
        )
      : null;
  }

  if (solicitadas.capacidades.length) {
    resultado.capacidadesCompativeis = cadastradas.capacidades.length
      ? solicitadas.capacidades.every((capacidade) =>
          cadastradas.capacidades.includes(capacidade),
        )
      : null;
  }

  const verificacoes = Object.values(resultado).filter(
    (valor) => valor !== null,
  );

  const compativeis = verificacoes.length ? verificacoes.every(Boolean) : null;

  return {
    ...resultado,
    compativeis,
    possuiCaracteristicaNaoInformada: Object.values(resultado).some(
      (valor) => valor === null,
    ),
  };
}

// ==========================================
// ATRIBUTOS IMPORTANTES
// ==========================================

// Se o cliente especificar um atributo, ele precisa
// estar confirmado no cadastro para liberar o preço.

const GRUPOS_ATRIBUTOS = [
  {
    nome: "formato",
    opcoes: ["RETA", "CURVA"],
  },
  {
    nome: "perfuracao",
    opcoes: ["NAO PERFURANTE", "PERFURANTE"],
  },
  {
    nome: "material",
    opcoes: ["INOX", "ACO CARBONO"],
  },
  {
    nome: "bolinha",
    opcoes: ["COM BOLINHA", "SEM BOLINHA"],
  },
];

function normalizarParaAtributo(texto) {
  return normalizarCaracteristicas(texto)
    .replace(/\bACO INOXIDAVEL\b/g, "INOX")
    .replace(/\bACO INOX\b/g, "INOX")
    .replace(/\bACO CARBONO\b/g, "ACO CARBONO");
}

function avaliarAtributos(busca, candidato) {
  const textoBusca = normalizarParaAtributo(busca);
  const textoCandidato = normalizarParaAtributo(candidato);

  const divergencias = [];
  const naoConfirmados = [];

  for (const grupo of GRUPOS_ATRIBUTOS) {
    const atributoSolicitado = grupo.opcoes.find((opcao) =>
      textoBusca.includes(opcao),
    );

    if (!atributoSolicitado) continue;

    const atributoCadastrado = grupo.opcoes.find((opcao) =>
      textoCandidato.includes(opcao),
    );

    if (!atributoCadastrado) {
      naoConfirmados.push(grupo.nome);
      continue;
    }

    if (atributoSolicitado !== atributoCadastrado) {
      divergencias.push(grupo.nome);
    }
  }

  return {
    compativel: divergencias.length === 0,
    divergencias,
    naoConfirmados,
  };
}

// ==========================================
// PESO DAS PALAVRAS
// ==========================================

function pesoToken(token) {
  if (["INOX", "AISI", "ACO", "CIRURGICO", "CIRURGICA"].includes(token)) {
    return 0.65;
  }

  return 1;
}

// ==========================================
// SIMILARIDADE
// ==========================================

function calcularSimilaridade(busca, candidato) {
  const tokensBusca = [...new Set(obterTokens(busca))];

  const tokensNome = [...new Set(obterTokens(candidato.produto))];

  const tokensKeywords = [...new Set(obterTokens(candidato.palavrasChave))];

  if (!tokensBusca.length) {
    return {
      score: 0,
      correspondencias: 0,
      coberturaNome: 0,
      coberturaPalavrasChave: 0,
    };
  }

  let pesoTotal = 0;
  let pesoCorrespondente = 0;
  let correspondencias = 0;
  let correspondenciasNome = 0;
  let correspondenciasKeyword = 0;

  for (const tokenBusca of tokensBusca) {
    const peso = pesoToken(tokenBusca);

    pesoTotal += peso;

    const noNome = tokensNome.some((token) =>
      tokensParecidos(tokenBusca, token),
    );

    const naKeyword = tokensKeywords.some((token) =>
      tokensParecidos(tokenBusca, token),
    );

    if (noNome || naKeyword) {
      pesoCorrespondente += peso;
      correspondencias++;
    }

    if (noNome) correspondenciasNome++;
    if (naKeyword) correspondenciasKeyword++;
  }

  const cobertura = pesoTotal ? pesoCorrespondente / pesoTotal : 0;

  const coberturaNome = correspondenciasNome / tokensBusca.length;

  const coberturaPalavrasChave = correspondenciasKeyword / tokensBusca.length;

  const score =
    cobertura * 0.65 + coberturaNome * 0.2 + coberturaPalavrasChave * 0.15;

  return {
    score,
    correspondencias,
    coberturaNome,
    coberturaPalavrasChave,
  };
}

// ==========================================
// EXTRAIR REFERÊNCIA
// ==========================================

function extrairReferencia(texto) {
  const original = normalizarTexto(texto);

  const resultado = original.match(
    /\b(?:REF|REFERENCIA|CODIGO|COD)\s+([A-Z0-9]+(?:\s*[-/]\s*[A-Z0-9]+)*)/,
  );

  if (!resultado) return null;

  return resultado[1].replace(/\s+/g, "");
}

// ==========================================
// NORMALIZAR EXPRESSÃO DE PESQUISA
// ==========================================

function normalizarConsultaFrase(texto) {
  return normalizarTexto(texto)
    .replace(
      /^(QUERO COTAR|QUERO|PRECISO DE|PRECISO|GOSTARIA DE COTAR|COTAR|COTACAO DE|COTACAO|PRODUTO)\s+/,
      "",
    )
    .replace(/\s+/g, " ")
    .trim();
}

// ==========================================
// PREÇOS
// ==========================================

function converterPreco(valor) {
  if (valor === null || valor === undefined || valor === "") {
    return null;
  }

  if (typeof valor === "number") {
    return Number.isFinite(valor) ? valor : null;
  }

  let texto = String(valor)
    .trim()
    .replace(/^R\$\s*/i, "")
    .replace(/\s/g, "");

  if (!texto) return null;

  if (/^-?\d{1,3}(,\d{3})+\.\d{1,2}$/.test(texto)) {
    texto = texto.replace(/,/g, "");
  } else if (/^-?\d{1,3}(\.\d{3})+,\d{1,2}$/.test(texto)) {
    texto = texto.replace(/\./g, "").replace(",", ".");
  } else if (/^-?\d+\.\d{1,2}$/.test(texto)) {
    // Decimal com ponto.
  } else if (/^-?\d+,\d{1,2}$/.test(texto)) {
    texto = texto.replace(",", ".");
  } else if (!/^-?\d+$/.test(texto)) {
    return null;
  }

  const numero = Number(texto);

  return Number.isFinite(numero) ? numero : null;
}

function formatarPreco(valor) {
  const numero = converterPreco(valor);

  if (numero === null) {
    throw new Error("Preço inválido na planilha.");
  }

  return numero.toLocaleString("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

// ==========================================
// IDENTIFICAR ABA PELO GID
// ==========================================

async function obterNomeAba(sheets, spreadsheetId, gid) {
  const resposta = await sheets.spreadsheets.get({
    spreadsheetId,
    fields: "sheets.properties",
  });

  const abas = resposta.data.sheets || [];

  const aba = abas.find(
    (item) => Number(item.properties.sheetId) === Number(gid),
  );

  if (!aba) {
    throw new Error(`Aba com GID ${gid} não encontrada.`);
  }

  return aba.properties.title;
}

// ==========================================
// LER PLANILHA
// ==========================================

async function lerPlanilha(sheets, spreadsheetId, gid) {
  const nomeAba = await obterNomeAba(sheets, spreadsheetId, gid);

  const intervalo = `'${nomeAba.replace(/'/g, "''")}'!A:Z`;

  const resposta = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range: intervalo,
    valueRenderOption: "UNFORMATTED_VALUE",
  });

  return resposta.data.values || [];
}

// ==========================================
// VALIDAR CNPJ
// ==========================================

function limparCNPJ(cnpj) {
  return String(cnpj || "").replace(/\D/g, "");
}

async function validarCNPJ(sheets, cnpj) {
  const cnpjLimpo = limparCNPJ(cnpj);

  if (cnpjLimpo.length !== 14) {
    return false;
  }

  const linhas = await lerPlanilha(
    sheets,
    PLANILHA_CONTATOS_ID,
    ABA_CONTATOS_GID,
  );

  return linhas.some((linha, indice) => {
    if (indice === 0) return false;

    return linha.some((celula) => limparCNPJ(celula) === cnpjLimpo);
  });
}

// ==========================================
// IDENTIFICAR DDD
// ==========================================

function obterDDD(telefone) {
  let numero = String(telefone || "").replace(/\D/g, "");

  if (numero.startsWith("55") && numero.length >= 12) {
    numero = numero.substring(2);
  }

  if (numero.length < 10) {
    return null;
  }

  return numero.substring(0, 2);
}

function obterPlanilhaPorDDD(ddd) {
  const dddsSP = ["11", "12", "13", "14", "15", "16", "17", "18", "19"];

  const dddsRJ = [
    "21",
    "22",
    "24",
    "31",
    "32",
    "33",
    "34",
    "35",
    "37",
    "38",
    "41",
    "42",
    "43",
    "44",
    "45",
    "46",
    "47",
    "48",
    "49",
    "51",
    "53",
    "54",
    "55",
  ];

  if (dddsSP.includes(ddd)) {
    return {
      id: PLANILHA_SP_ID,
      gid: ABA_SP_GID,
    };
  }

  if (dddsRJ.includes(ddd)) {
    return {
      id: PLANILHA_RJ_ID,
      gid: ABA_RJ_GID,
    };
  }

  return {
    id: PLANILHA_DEMAIS_ID,
    gid: ABA_DEMAIS_GID,
  };
}

// ==========================================
// MONTAR PRODUTO
// ==========================================

// function montarProduto(linha, numeroLinha, planilha) {
//   return {
//     id_catalogo: normalizarIdCatalogo(
//       `${planilha.id}:${planilha.gid}:${numeroLinha}`,
//     ),
//     referencia: String(linha[0] || "").trim(),
//     produto: String(linha[1] || "").trim(),
//     precoOriginal: linha[5],
//     palavrasChave: String(linha[6] || "").trim(),
//   };
// }


function montarProduto(linha, numeroLinha, planilha) {
  const idCatalogo = normalizarIdCatalogo(
    `${planilha.id}:${planilha.gid}:${numeroLinha}`,
  );

  const produto = String(linha[1] || "").trim();
  const referencia = String(linha[0] || "").trim();
  const precoOriginal = linha[5];

  // Auditoria específica da referência 163
  if (referencia === "163") {
    console.log("========== AUDITORIA REF 163 ==========");
    console.log({
      linhaFisica: numeroLinha,
      referencia,
      produto,
      colunaA: linha[0],
      colunaB: linha[1],
      colunaC: linha[2],
      colunaD: linha[3],
      colunaE: linha[4],
      colunaF: linha[5],
      colunaF_tipo: typeof linha[5],
      colunaG: linha[6],
      precoConvertido: converterPreco(precoOriginal),
      idCatalogo,
    });
    console.log("========================================");
  }

  return {
    id_catalogo: idCatalogo,
    referencia,
    produto,
    precoOriginal,
    palavrasChave: String(linha[6] || "").trim(),
  };
}


// ==========================================
// AVALIAR CANDIDATO
// ==========================================

function avaliarCandidato(produtoInformado, item) {
  const textoCatalogo = `${item.produto} ${item.palavrasChave}`;

  const similaridade = calcularSimilaridade(produtoInformado, item);

  const caracteristicas = avaliarCaracteristicas(
    produtoInformado,
    textoCatalogo,
  );

  const atributos = avaliarAtributos(produtoInformado, textoCatalogo);

  let score = similaridade.score;

  if (caracteristicas.compativeis === true) {
    score += 0.08;
  }

  if (caracteristicas.compativeis === false) {
    score -= 0.35;
  }

  if (!atributos.compativel) {
    score -= 0.35;
  }

  if (atributos.naoConfirmados.length) {
    score -= 0.08 * atributos.naoConfirmados.length;
  }

  score = Math.max(0, Math.min(1, score));

  const possuiCaracteristicaNaoInformada =
    caracteristicas.possuiCaracteristicaNaoInformada ||
    atributos.naoConfirmados.length > 0;

  const possuiDivergencia =
    caracteristicas.compativeis === false || atributos.divergencias.length > 0;

  return {
    ...item,
    score,
    correspondencias: similaridade.correspondencias,
    medidasCompativeis: caracteristicas.compativeis,
    dimensoesCompativeis: caracteristicas.dimensoesCompativeis,
    capacidadesCompativeis: caracteristicas.capacidadesCompativeis,
    possuiCaracteristicaNaoInformada,
    possuiDivergencia,
    atributosNaoConfirmados: atributos.naoConfirmados,
    atributosDivergentes: atributos.divergencias,
  };
}

// ==========================================
// BUSCA DE PRODUTOS
// ==========================================
// ==========================================
// BUSCA DE PRODUTOS POR REFERÊNCIA E NOME
// ==========================================

function buscarProduto(linhas, produtoInformado, planilha, idCatalogo = "") {
  const buscaOriginal = String(produtoInformado || "").trim();
  const busca = normalizarTexto(buscaOriginal);

  if (!busca && !idCatalogo) {
    return {
      tipo: "nao_encontrado",
    };
  }

  // ==========================================
  // 1. MONTAR PRODUTOS DO CATÁLOGO
  // ==========================================

  const produtos = linhas
    .slice(1)
    .map((linha, indice) => ({
      linha,
      numeroLinha: indice + 2,
    }))
    .filter(
      (item) =>
        (item.linha[0] !== undefined && item.linha[0] !== "") ||
        (item.linha[1] !== undefined && item.linha[1] !== ""),
    )
    .map((item) => montarProduto(item.linha, item.numeroLinha, planilha));

  if (!produtos.length) {
    return {
      tipo: "nao_encontrado",
    };
  }

  // ==========================================
  // 2. IDENTIFICAR SE EXISTE ID DE CATÁLOGO
  // ==========================================

  // Quando o cliente já escolheu uma variação,
  // não devemos pesquisar novamente pelo nome.
  // O ID identifica diretamente a linha selecionada.

  if (idCatalogo) {
    const idNormalizado = normalizarIdCatalogo(idCatalogo);

    const selecionado = produtos.find(
      (item) => normalizarIdCatalogo(item.id_catalogo) === idNormalizado,
    );

    if (!selecionado) {
      return {
        tipo: "id_catalogo_invalido",
      };
    }

    return {
      tipo: "encontrado",
      produto: selecionado,
      confianca: 1,
    };
  }

  // ==========================================
  // 3. EXTRAIR REFERÊNCIA INFORMADA
  // ==========================================

  let referenciaInformada = extrairReferencia(buscaOriginal);

  // Também reconhece formatos como:
  // "1 ABAIXA LÍNGUA"
  // "1 - ABAIXA LÍNGUA"
  // "1: ABAIXA LÍNGUA"
  //
  // Não considera números que aparecem depois
  // do nome, como medidas e dimensões.

  if (!referenciaInformada) {
    const inicio = buscaOriginal.match(
      /^\s*([A-Z0-9]+)\s*(?:[-:]\s*|\s+)(?=[A-ZÀ-Ú])/,
    );

    if (inicio) {
      referenciaInformada = normalizarTexto(inicio[1]).replace(/\s/g, "");
    }
  }

  // ==========================================
  // 4. BUSCAR PRIMEIRO PELA REFERÊNCIA
  // ==========================================

  if (referenciaInformada) {
    const referenciaNormalizada = normalizarTexto(referenciaInformada).replace(
      /\s/g,
      "",
    );

    const encontrados = produtos.filter(
      (item) =>
        normalizarTexto(item.referencia).replace(/\s/g, "") ===
        referenciaNormalizada,
    );

    // ------------------------------------------
    // 4.1 REFERÊNCIA ÚNICA
    // ------------------------------------------

    if (encontrados.length === 1) {
      return {
        tipo: "encontrado",
        produto: encontrados[0],
        confianca: 1,
      };
    }

    // ------------------------------------------
    // 4.2 REFERÊNCIA REPETIDA
    // ------------------------------------------

    if (encontrados.length > 1) {
      // Remove a referência do texto de pesquisa
      // para comparar o nome do produto.
      const nomeParaComparacao = buscaOriginal
        .replace(
          new RegExp(
            "^\\s*(?:REF(?:ERENCIA)?|COD(?:IGO)?)[\\s:.-]*" +
              referenciaInformada.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
            "i",
          ),
          "",
        )
        .replace(
          new RegExp(
            "^\\s*" +
              referenciaInformada.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") +
              "\\s*(?:[-:]\\s*)?",
            "i",
          ),
          "",
        )
        .trim();

      const nomeBusca = nomeParaComparacao || buscaOriginal;

      // Avalia cada produto usando:
      // - Nome da coluna B
      // - Palavras-chave da coluna G
      // - Medidas e dimensões
      // - Atributos técnicos

      const candidatos = encontrados.map((item) =>
        avaliarCandidato(nomeBusca, item),
      );

      candidatos.sort((a, b) => b.score - a.score);

      const melhor = candidatos[0];
      const segundo = candidatos[1];

      const diferenca = segundo ? melhor.score - segundo.score : 1;

      // Verifica se o cliente informou características técnicas.
      const caracteristicasSolicitadas = extrairCaracteristicas(nomeBusca);

      const possuiMedida = caracteristicasSolicitadas.medidasSimples.length > 0;

      const possuiDimensao = caracteristicasSolicitadas.dimensoes.length > 0;

      const possuiCapacidade =
        caracteristicasSolicitadas.capacidades.length > 0;

      // Só exige compatibilidade nas características
      // que realmente foram solicitadas pelo cliente.

      const medidasConfirmadas =
        !possuiMedida || melhor.medidasCompativeis === true;

      const dimensoesConfirmadas =
        !possuiDimensao || melhor.dimensoesCompativeis === true;

      const capacidadesConfirmadas =
        !possuiCapacidade || melhor.capacidadesCompativeis === true;

      const atributosConfirmados =
        !melhor.atributosNaoConfirmados.length &&
        !melhor.atributosDivergentes.length;

      const caracteristicasConfirmadas =
        medidasConfirmadas &&
        dimensoesConfirmadas &&
        capacidadesConfirmadas &&
        atributosConfirmados &&
        !melhor.possuiDivergencia;

      // Exige evidência suficiente para selecionar
      // automaticamente uma variação.

      const nomeIdentificado =
        nomeBusca !== buscaOriginal || nomeBusca.length > 0;

      const altaConfianca =
        nomeIdentificado &&
        melhor.score >= 0.92 &&
        melhor.correspondencias >= 2 &&
        diferenca >= 0.12 &&
        caracteristicasConfirmadas;

      if (altaConfianca) {
        const produtoSelecionado = produtos.find(
          (item) => item.id_catalogo === melhor.id_catalogo,
        );

        return {
          tipo: "encontrado",
          produto: produtoSelecionado,
          confianca: Number(melhor.score.toFixed(3)),
        };
      }

      // Se não for possível identificar com segurança,
      // retorna as opções sem liberar preço.

      return {
        tipo: "ambiguo",
        candidatos: candidatos.slice(0, 5),
      };
    }
  }

  // ==========================================
  // 5. BUSCA POR REFERÊNCIA ISOLADA
  // ==========================================

  const buscaSemEspacos = busca.replace(/\s/g, "");

  const porReferencia = produtos.filter(
    (item) =>
      normalizarTexto(item.referencia).replace(/\s/g, "") === buscaSemEspacos,
  );

  if (porReferencia.length === 1) {
    return {
      tipo: "encontrado",
      produto: porReferencia[0],
      confianca: 1,
    };
  }

  if (porReferencia.length > 1) {
    return {
      tipo: "ambiguo",
      candidatos: porReferencia
        .slice(0, 5)
        .map((item) => avaliarCandidato(buscaOriginal, item)),
    };
  }

  // ==========================================
  // 6. BUSCAR EXPRESSÃO COMERCIAL COMPLETA
  // ==========================================

  // A coluna B é a fonte principal.
  // A expressão completa precisa aparecer no nome comercial.
  // A coluna G não pode aprovar um produto sozinha.

  const fraseBusca = normalizarConsultaFrase(buscaOriginal);

  const correspondenciasExatas = produtos.filter((item) => {
    const nomeProduto = normalizarTexto(item.produto);

    return fraseBusca.length >= 5 && nomeProduto.includes(fraseBusca);
  });

  if (correspondenciasExatas.length > 0) {
    // Remove registros repetidos com mesmo nome e referência.
    const unicos = [];
    const vistos = new Set();

    for (const item of correspondenciasExatas) {
      const chave =
        `${normalizarTexto(item.produto)}|` +
        `${normalizarTexto(item.referencia)}`;

      if (!vistos.has(chave)) {
        vistos.add(chave);
        unicos.push(item);
      }
    }

    // Uma única correspondência comercial:
    // retorna diretamente o produto e libera a consulta do preço.
    if (unicos.length === 1) {
      return {
        tipo: "encontrado",
        produto: unicos[0],
        confianca: 1,
      };
    }

    // Mais de uma correspondência:
    // solicita confirmação do cliente.
    return {
      tipo: "ambiguo",
      candidatos: unicos.map((item) => avaliarCandidato(buscaOriginal, item)),
    };
  }

  // ==========================================
  // 6. BUSCAR NOME EXATO
  // ==========================================

  const tokensBusca = obterTokens(buscaOriginal).join(" ");

  const exatos = produtos.filter((item) => {
    const nome = obterTokens(item.produto).join(" ");

    return nome && nome === tokensBusca;
  });

  if (exatos.length === 1) {
    const avaliado = avaliarCandidato(buscaOriginal, exatos[0]);

    const caracteristicas = extrairCaracteristicas(buscaOriginal);

    const temMedida = caracteristicas.medidasSimples.length > 0;

    const temDimensao = caracteristicas.dimensoes.length > 0;

    const temCapacidade = caracteristicas.capacidades.length > 0;

    const compativel =
      !avaliado.possuiDivergencia &&
      (!temMedida || avaliado.medidasCompativeis === true) &&
      (!temDimensao || avaliado.dimensoesCompativeis === true) &&
      (!temCapacidade || avaliado.capacidadesCompativeis === true) &&
      !avaliado.atributosNaoConfirmados.length &&
      !avaliado.atributosDivergentes.length;

    if (compativel) {
      return {
        tipo: "encontrado",
        produto: exatos[0],
        confianca: 1,
      };
    }

    return {
      tipo: "ambiguo",
      candidatos: [avaliado],
    };
  }

  if (exatos.length > 1) {
    return {
      tipo: "ambiguo",
      candidatos: exatos
        .slice(0, 5)
        .map((item) => avaliarCandidato(buscaOriginal, item)),
    };
  }

  // ==========================================
  // 7. BUSCA POR NOME E PALAVRAS-CHAVE
  // ==========================================

  // A função calcularSimilaridade já considera:
  // - Nome do produto na coluna B
  // - Palavras-chave na coluna G

  const candidatos = produtos.map((item) =>
    avaliarCandidato(buscaOriginal, item),
  );

  // Ordena os candidatos do maior para o menor score
  candidatos.sort((a, b) => b.score - a.score);

  // Define a quantidade mínima de correspondências
  const tokensPesquisa = obterTokens(buscaOriginal);

  const minimoCorrespondencias = tokensPesquisa.length >= 2 ? 2 : 1;

  // Filtra apenas os candidatos relevantes
  const relevantes = candidatos.filter(
    (item) =>
      item.score >= 0.45 && item.correspondencias >= minimoCorrespondencias,
  );

  // Se nenhum produto atender aos critérios
  if (relevantes.length === 0) {
    return {
      tipo: "nao_encontrado",
    };
  }

  // Identifica o melhor candidato e o segundo colocado
  const melhor = relevantes[0];
  const segundo = relevantes[1];

  // Calcula a diferença entre os dois melhores resultados
  const diferenca = segundo ? melhor.score - segundo.score : 1;

  // Extrai as características informadas na pesquisa
  const caracteristicas = extrairCaracteristicas(buscaOriginal);

  const temMedida = caracteristicas.medidasSimples.length > 0;

  const temDimensao = caracteristicas.dimensoes.length > 0;

  const temCapacidade = caracteristicas.capacidades.length > 0;

  // Verifica a compatibilidade das medidas
  const medidasConfirmadas = !temMedida || melhor.medidasCompativeis === true;

  // Verifica a compatibilidade das dimensões
  const dimensoesConfirmadas =
    !temDimensao || melhor.dimensoesCompativeis === true;

  // Verifica a compatibilidade das capacidades
  const capacidadesConfirmadas =
    !temCapacidade || melhor.capacidadesCompativeis === true;

  // Verifica os atributos do produto
  const atributosConfirmados =
    !melhor.atributosNaoConfirmados.length &&
    !melhor.atributosDivergentes.length;

  // Confirma se todas as características são compatíveis
  const caracteristicasConfirmadas =
    medidasConfirmadas &&
    dimensoesConfirmadas &&
    capacidadesConfirmadas &&
    atributosConfirmados &&
    !melhor.possuiDivergencia;

  // ==========================================
  // 8. SELEÇÃO AUTOMÁTICA COM ALTA CONFIANÇA
  // ==========================================

  const altaConfianca =
    melhor.score >= 0.92 &&
    melhor.correspondencias >= 2 &&
    diferenca >= 0.12 &&
    caracteristicasConfirmadas;

  if (altaConfianca) {
    const produtoSelecionado = produtos.find(
      (item) => item.id_catalogo === melhor.id_catalogo,
    );

    return {
      tipo: "encontrado",
      produto: produtoSelecionado,
      confianca: Number(melhor.score.toFixed(3)),
    };
  }

  // ==========================================
  // 9. RETORNAR OPÇÕES PARA O CLIENTE
  // ==========================================

  return {
    tipo: "ambiguo",
    candidatos: relevantes.slice(0, 5),
  };
}

// ==========================================
// FORMATAR CANDIDATOS PARA A API
// ==========================================

function formatarCandidatos(candidatos) {
  return candidatos.map((item) => ({
    id_catalogo: item.id_catalogo,
    referencia: item.referencia,
    produto: item.produto,
    medidas_compativeis: item.medidasCompativeis,
    dimensoes_compativeis: item.dimensoesCompativeis,
    capacidades_compativeis: item.capacidadesCompativeis,
    score: Number(item.score.toFixed(3)),
  }));
}

// ==========================================
// RESPOSTA DA API
// ==========================================

module.exports = async (req, res) => {
  res.setHeader("Content-Type", "application/json; charset=utf-8");

  if (req.method !== "GET") {
    return res.status(405).json({
      status: "error",
      success: false,
      message: "Método não permitido. Utilize GET.",
    });
  }

  try {
    const produto = obterParametro(req, "produto");

    const idCatalogo = normalizarIdCatalogo(obterParametro(req, "id_catalogo"));

    const telefone = obterParametro(req, "telefone");

    const cnpj = obterParametro(req, "cnpj");

    if ((!produto && !idCatalogo) || !telefone || !cnpj) {
      return res.status(400).json({
        status: "error",
        success: false,
        message: "Informe produto, telefone e CNPJ.",
      });
    }

    const sheets = await conectarGoogle();

    // 1. VALIDAR CNPJ

    const cnpjValido = await validarCNPJ(sheets, cnpj);

    if (!cnpjValido) {
      return res.status(200).json({
        status: "cnpj_invalido",
        success: false,
        message: "CNPJ não encontrado no cadastro de clientes.",
      });
    }

    // 2. IDENTIFICAR DDD

    const ddd = obterDDD(telefone);

    if (!ddd) {
      return res.status(200).json({
        status: "error",
        success: false,
        message: "Telefone inválido ou sem DDD.",
      });
    }

    // 3. SELECIONAR PLANILHA REGIONAL

    const planilha = obterPlanilhaPorDDD(ddd);

    // 4. LER PLANILHA

    const linhas = await lerPlanilha(sheets, planilha.id, planilha.gid);

    // 5. BUSCAR PRODUTO

    const resultado = buscarProduto(linhas, produto, planilha, idCatalogo);

    // 6. IDENTIFICADOR DE VARIAÇÃO INVÁLIDO

    if (resultado.tipo === "id_catalogo_invalido") {
      return res.status(200).json({
        status: "selection_not_found",
        success: false,
        id_catalogo: idCatalogo,
        ddd,
        message:
          "A variação selecionada não foi localizada no catálogo atual. Faça uma nova busca pelo produto.",
      });
    }

    // 7. PRODUTO NÃO ENCONTRADO

    if (resultado.tipo === "nao_encontrado") {
      return res.status(200).json({
        status: "not_found",
        success: false,
        produto,
        ddd,
        message: `Não localizei o produto: ${produto}.`,
      });
    }

    // 8. MÚLTIPLAS POSSIBILIDADES

    if (resultado.tipo === "ambiguo") {
      const candidatosOriginais = formatarCandidatos(resultado.candidatos);

      // Remove duplicados com mesmo nome e mesma referência
      const candidatosUnicos = [];
      const produtosExibidos = new Set();

      for (const item of candidatosOriginais) {
        const nomeNormalizado = String(item.produto || "")
          .normalize("NFD")
          .replace(/[\u0300-\u036f]/g, "")
          .trim()
          .toUpperCase()
          .replace(/\s+/g, " ");

        const referenciaNormalizada = String(item.referencia || "")
          .trim()
          .toUpperCase();

        const chave = `${nomeNormalizado}|${referenciaNormalizada}`;

        if (!produtosExibidos.has(chave)) {
          produtosExibidos.add(chave);
          candidatosUnicos.push(item);
        }
      }

      const opcoes = candidatosUnicos.map((item, indice) => ({
        opcao: indice + 1,
        id_catalogo: item.id_catalogo,
        referencia: item.referencia,
        produto: item.produto,
        descricao: `Opção ${indice + 1}: ${item.produto} (Ref. ${item.referencia})`,
      }));

      const listaOpcoes = opcoes.map((item) => item.descricao).join("\n");

      const message =
        `Encontrei ${opcoes.length} opções para o produto "${produto}".\n\n` +
        `${listaOpcoes}\n\n` +
        `Apresente as opções ao cliente pelo número, nome e referência. ` +
        `Não informe preços nesta etapa. Aguarde o cliente escolher uma opção.`;

      return res.status(200).json({
        status: "multiple_matches",
        success: false,
        produto_solicitado: produto,
        ddd,
        candidatos: candidatosUnicos,
        opcoes,
        message,
      });
    }
    // 9. PRODUTO ENCONTRADO

    const produtoEncontrado = resultado.produto;

    const precoFormatado = formatarPreco(produtoEncontrado.precoOriginal);

    const ipi = IPI_PADRAO;

    const message =
      `${produtoEncontrado.produto} ` +
      `(ref. ${produtoEncontrado.referencia}): ` +
      `R$ ${precoFormatado} + ${ipi} de IPI.`;

    return res.status(200).json({
      status: "success",
      success: true,
      id_catalogo: produtoEncontrado.id_catalogo,
      produto: produtoEncontrado.produto,
      referencia: String(produtoEncontrado.referencia),
      preco: precoFormatado,
      ipi,
      ddd,
      message,
    });
  } catch (erro) {
    console.error("ERRO NA API BUSCAR:", erro.stack || erro.message);

    return res.status(500).json({
      status: "error",
      success: false,
      message:
        "Ocorreu um erro ao consultar o produto. Encaminhe para atendimento humano.",
    });
  }
};
