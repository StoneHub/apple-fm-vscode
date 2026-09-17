import Foundation
import FoundationModels

private struct Input: Decodable {
    let prompt: String?
    let instructions: String?
    let response: String?
}

private struct Output: Encodable {
    let contextSize: Int
    let promptTokens: Int?
    let instructionTokens: Int?
    let responseTokens: Int?
    let error: String?

    enum CodingKeys: String, CodingKey {
        case contextSize, promptTokens, instructionTokens, responseTokens, error
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(contextSize, forKey: .contextSize)
        try container.encodeIfPresent(promptTokens, forKey: .promptTokens)
        try container.encodeIfPresent(instructionTokens, forKey: .instructionTokens)
        try container.encodeIfPresent(responseTokens, forKey: .responseTokens)
        try container.encodeIfPresent(error, forKey: .error)
    }
}

private func write(_ output: Output) {
    do {
        let data = try JSONEncoder().encode(output)
        FileHandle.standardOutput.write(data)
        FileHandle.standardOutput.write(Data("\n".utf8))
    } catch {
        // Encoding these fixed fields cannot fail; keep stdout JSON even if that changes.
        FileHandle.standardOutput.write(Data("{\"contextSize\":0,\"error\":\"encoding failed\"}\n".utf8))
    }
}

@main
struct ModelInfo {
    static func main() async {
        let inputData = FileHandle.standardInput.readDataToEndOfFile()
        do {
            let input = try JSONDecoder().decode(Input.self, from: inputData)
            if input.prompt != nil || input.instructions != nil || input.response != nil {
                let model = SystemLanguageModel.default
                var promptTokens: Int?
                var instructionTokens: Int?
                var responseTokens: Int?
                if let prompt = input.prompt { promptTokens = try await model.tokenCount(for: Prompt(prompt)) }
                if let instructions = input.instructions { instructionTokens = try await model.tokenCount(for: Instructions(instructions)) }
                if let response = input.response { responseTokens = try await model.tokenCount(for: Prompt(response)) }
                write(Output(contextSize: model.contextSize, promptTokens: promptTokens, instructionTokens: instructionTokens, responseTokens: responseTokens, error: nil))
            } else {
                write(Output(contextSize: SystemLanguageModel.default.contextSize, promptTokens: nil, instructionTokens: nil, responseTokens: nil, error: nil))
            }
        } catch {
            write(Output(contextSize: SystemLanguageModel.default.contextSize, promptTokens: nil, instructionTokens: nil, responseTokens: nil, error: "model info unavailable"))
        }
    }
}
