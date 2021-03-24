import { SelectableValue } from '@grafana/data';
import { CompletionItemGroup, InlineField, TypeaheadOutput } from '@grafana/ui';
import { debounce } from 'lodash';
import React, { PureComponent } from 'react';
import { Dictionary } from '../../Dictionary';
import { migrateQuery } from '../../migrations';
import { getDefaultStat } from '../../queryInfo';
import { ListEventsQuery, ParameterInfo, ParameterSamplesQuery, QueryType, StatType, YamcsQuery } from '../../types';
import { AutocompleteField } from '../AutocompleteField/AutocompleteField';
import { statRegistry, StatsPicker } from './StatsPicker';
import { YamcsQueryEditorProps } from './types';

type Props = YamcsQueryEditorProps<YamcsQuery | ParameterSamplesQuery | ListEventsQuery>;

interface State {
    parameter?: ParameterInfo;
    loading: boolean;
}

export class ParameterQueryEditor extends PureComponent<Props, State> {
    state: State = {
        loading: true,
    };

    debouncedSearch: any;
    dictionary?: Dictionary;

    constructor(props: Props) {
        super(props);
        this.debouncedSearch = debounce(this.loadAsyncOptions, 300, {
            leading: true,
            trailing: true,
        });
    }

    async componentDidMount() {
        this.updateParameterInfo();
    }

    async componentDidUpdate(oldProps: Props) {
        const { query } = this.props;
        const parameterChanged = query?.parameter !== oldProps?.query?.parameter;
        if (parameterChanged) {
            if (!query.parameter) {
                this.setState({ parameter: undefined });
            } else {
                this.setState({ loading: true });
                this.updateParameterInfo();
            }
        }
    }

    onTypeahead = async (input: string): Promise<TypeaheadOutput> => {
        const suggestions = await this.suggestParameters(input);
        return { suggestions };
    }

    private async suggestParameters(q: string): Promise<CompletionItemGroup[]> {
        const page = await this.props.datasource.yamcs.listParameters({ q, limit: 15 });

        // Group by space system
        const groups = new Map<String, CompletionItemGroup>();
        for (const parameter of (page.parameters || [])) {
            const spaceSystem = this.extractSpacesystem(parameter.qualifiedName);
            let group = groups.get(spaceSystem);
            if (!group) {
                group = {
                    label: spaceSystem,
                    items: [],
                };
                groups.set(spaceSystem, group);
            }
            group.items.push({
                label: parameter.name,
                filterText: parameter.qualifiedName.toLowerCase(),
                insertText: parameter.qualifiedName,
                documentation: parameter.longDescription || parameter.shortDescription,
            })
        }
        return [...groups.values()];
    }

    private extractSpacesystem(qualifiedName: string) {
        const idx = qualifiedName.lastIndexOf('/');
        return (idx === -1) ? qualifiedName : qualifiedName.substring(0, idx);
    }

    loadAsyncOptions = (query: string) => {
        return this.props.datasource.yamcs.listParameters({
            q: query,
            limit: 20,
        }).then(page => {
            const result: Array<SelectableValue<string>> = [];
            for (const parameter of (page.parameters || [])) {
                result.push({
                    label: parameter.qualifiedName,
                    value: parameter.qualifiedName,
                    description: parameter.type?.engType.toUpperCase(),
                });
            }
            return result;
        });
    };

    private async updateParameterInfo() {
        const { query, datasource } = this.props;
        const update: State = { loading: false };
        if (query?.parameter) {
            const dictionary = await datasource.loadDictionary();
            update.parameter = dictionary.getParameterInfo(query.parameter);
        }
        this.setState(update);
    }

    onParameterChange = (parameter?: string) => {
        const { onChange, query, onRunQuery } = this.props;
        let update: YamcsQuery = { ...query, parameter };
        // Make sure the selected stats are actually supported
        if (update.queryType === QueryType.ParameterSamples) {
            if (update.parameter) {
                const samplesUpdate = update as ParameterSamplesQuery;
                const info = this.state.parameter;
                if (!samplesUpdate.stats) {
                    samplesUpdate.stats = [];
                }
                if (info) {
                    samplesUpdate.stats = samplesUpdate.stats.filter(a => statRegistry.get(a).isValid(info));
                }
                if (!samplesUpdate.stats.length) {
                    samplesUpdate.stats = [getDefaultStat(info)];
                }
            }
        }
        onChange(update);
        onRunQuery();
    };

    onStatsChange = (stats: StatType[]) => {
        const { onChange, query, onRunQuery } = this.props;
        onChange({ ...query, stats } as any);
        onRunQuery();
    };

    renderStatsRow(query: ParameterSamplesQuery) {
        const { parameter } = this.state;
        return (
            <div className="gf-form">
                <InlineField label="Stats" labelWidth={14} grow={true}>
                    <StatsPicker
                        stats={query.stats ?? []}
                        onChange={this.onStatsChange}
                        defaultStat={getDefaultStat(parameter)}
                        menuPlacement="bottom"
                    />
                </InlineField>
            </div>
        );
    }

    render() {
        const query = migrateQuery(this.props.query);
        const showStats = query.parameter && query.queryType === QueryType.ParameterSamples;
        return (
            <>
                <div className="gf-form">
                    <InlineField
                        labelWidth={14}
                        label="Parameter"
                        tooltip="Fully qualified name"
                        grow={true}>
                        <AutocompleteField
                            onTypeahead={this.onTypeahead}
                            onSelectSuggestion={this.onParameterChange}
                            onBlur={this.onParameterChange}
                            placeholder="Type to search"
                            query={query.parameter}
                        />
                    </InlineField>
                </div>
                {showStats && this.renderStatsRow(query as any)}
            </>
        );
    };
}
